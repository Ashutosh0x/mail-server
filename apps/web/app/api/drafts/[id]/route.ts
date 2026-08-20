import type { NextRequest } from "next/server";
import {
  authorizedSenders,
  deleteDraft,
  loadDraft,
  saveDraft,
  type DraftInput,
} from "@/lib/server/compose";
import { isValidAddress, isHeaderSafe } from "@/lib/server/mime";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/drafts/:id — load a draft. 404 for anyone else's. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const draft = loadDraft(auth.user.id, id);
    if (!draft) return fail(404, "not_found", "That draft no longer exists.");
    // Senders travel with the draft so reopening one needs a single request,
    // rather than creating a throwaway draft just to learn who may send.
    return ok({ draft, senders: authorizedSenders(auth.user.id) });
  });
}

/**
 * PUT /api/drafts/:id — save.
 *
 * Recipients are validated here as well as at send time. Storing a malformed
 * address would mean the failure surfaces only when the user presses Send,
 * long after they typed it.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Send a JSON object.");

    const parsed = parseDraft(body);
    if ("error" in parsed) return fail(400, parsed.code, parsed.error);

    const expectedVersion =
      typeof body.version === "number" && Number.isFinite(body.version) ? body.version : undefined;

    const result = saveDraft(auth.user.id, id, parsed.draft, expectedVersion);

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail(404, "not_found", "That draft no longer exists.");
      }
      // 409 with the server's copy attached, so the client can compare rather
      // than guess. Never a silent overwrite of newer content.
      return ok(
        {
          conflict: true,
          message: "This draft was changed somewhere else. Your copy was not saved.",
          current: result.current,
        },
        409
      );
    }

    return ok({ version: result.version, savedAt: new Date().toISOString() });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    if (!deleteDraft(auth.user.id, id)) {
      return fail(404, "not_found", "That draft no longer exists.");
    }
    return ok({ deleted: true });
  });
}

/** Validate and normalise a draft payload. Never trusts a field's shape. */
function parseDraft(
  body: Record<string, unknown>
): { draft: DraftInput } | { error: string; code: string } {
  const addresses = (value: unknown, field: string) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return null;
    const out: { name?: string | null; email: string }[] = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) return null;
      const email = (entry as { email?: unknown }).email;
      if (typeof email !== "string" || !isValidAddress(email)) return null;
      const name = (entry as { name?: unknown }).name;
      // A display name ends up in a From/To header, so a line break in it is
      // header injection.
      if (name !== undefined && name !== null && (typeof name !== "string" || !isHeaderSafe(name))) {
        return null;
      }
      out.push({ name: (name as string | null) ?? null, email });
    }
    void field;
    return out;
  };

  const to = addresses(body.to, "to");
  const cc = addresses(body.cc, "cc");
  const bcc = addresses(body.bcc, "bcc");
  if (to === null || cc === null || bcc === null) {
    return { error: "One of the recipients is not a valid email address.", code: "invalid_recipient" };
  }

  const subject = typeof body.subject === "string" ? body.subject : "";
  if (!isHeaderSafe(subject)) {
    return { error: "The subject cannot contain a line break.", code: "invalid_subject" };
  }
  if (subject.length > 998) {
    return { error: "That subject is too long.", code: "invalid_subject" };
  }

  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";

  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((value): value is string => typeof value === "string")
    : [];

  return {
    draft: {
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      attachmentIds,
      inReplyTo: typeof body.inReplyTo === "string" ? body.inReplyTo : null,
      references: Array.isArray(body.references)
        ? body.references.filter((value): value is string => typeof value === "string")
        : [],
    },
  };
}
