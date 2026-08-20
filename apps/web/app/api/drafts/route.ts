import type { NextRequest } from "next/server";
import { createDraft, createReplyDraft, authorizedSenders, type ReplyMode } from "@/lib/server/compose";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: ReplyMode[] = ["reply", "replyAll", "forward"];

/**
 * POST /api/drafts — start a draft.
 *
 * The From address comes from the account, never from the request. A From the
 * client can choose is a From anyone can forge, which is exactly what
 * SPF/DKIM/DMARC exist downstream to prevent.
 *
 * With `{ mode, sourceId }` the draft starts as a reply, reply-all or forward.
 * Recipients, subject, quoted body and the threading headers are all derived
 * from the stored message on this side — see `createReplyDraft` for why none of
 * that is accepted from the client.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const senders = authorizedSenders(auth.user.id);
    if (senders.length === 0) {
      return fail(409, "no_sender", "This account has no address to send from.");
    }
    const from = senders[0]!;

    // A body is optional: a plain Compose sends none at all.
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const mode = typeof body?.mode === "string" ? body.mode : null;
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId : null;

    if (mode === null && sourceId === null) {
      return ok({ draftId: createDraft(auth.user.id, from), senders }, 201);
    }

    if (!mode || !MODES.includes(mode as ReplyMode)) {
      return fail(400, "invalid_mode", "Specify reply, replyAll or forward.");
    }
    if (!sourceId) {
      return fail(400, "missing_source", "Name the message being answered.");
    }

    const draftId = createReplyDraft(auth.user.id, from, sourceId, mode as ReplyMode);
    // 404 rather than 403 for someone else's message: telling the caller the id
    // exists is the whole of an IDOR probe.
    if (!draftId) return fail(404, "not_found", "That message no longer exists.");

    return ok({ draftId, senders }, 201);
  });
}
