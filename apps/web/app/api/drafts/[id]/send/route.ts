import type { NextRequest } from "next/server";
import { sendDraft } from "@/lib/server/compose";
import { deliver, transportConfigured } from "@/lib/server/transport";
import { audit } from "@/lib/server/auth";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drafts/:id/send
 *
 * The honest pipeline:
 *
 *   validate → authorize the From → build MIME → enqueue → attempt delivery
 *
 * The response reports what actually happened. `queued` means the message is
 * durably stored and waiting; `sent` means an SMTP server accepted it. The UI
 * never shows "Sent" on our own say-so.
 *
 * Idempotency: `Idempotency-Key` makes a retried or double-clicked submit
 * return the ORIGINAL result rather than sending twice. The column is UNIQUE,
 * so the guarantee is the database's, not a race-prone check-then-act.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const headerKey = request.headers.get("idempotency-key");
    const idempotencyKey =
      typeof headerKey === "string" && headerKey.length > 0 && headerKey.length <= 200
        ? headerKey
        : undefined;

    const from = typeof body.from === "string" ? body.from : undefined;

    const outcome = sendDraft(auth.user.id, id, { idempotencyKey, from });

    if (!outcome.ok) {
      const status =
        outcome.error.code === "not_found" ? 404
        : outcome.error.code === "unauthorized_sender" ? 403
        : outcome.error.code === "too_large" ? 413
        : 400;
      return fail(status, outcome.error.code, outcome.error.message);
    }

    audit(
      auth.user.id,
      "message.queued",
      { queueId: outcome.result.queueId, messageId: outcome.result.messageId },
      "info",
      { ip: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent") }
    );

    // Attempt delivery immediately. A real queue worker would do this out of
    // band; doing it inline here means the user learns the outcome now, and
    // the row is already durable either way.
    let delivery: { status: string; detail: string };
    try {
      delivery = await deliver(outcome.result.queueId);
    } catch (error) {
      delivery = {
        status: "deferred",
        detail: error instanceof Error ? error.message : "Delivery could not be attempted.",
      };
    }

    if (delivery.status === "sent") {
      audit(auth.user.id, "message.sent", { queueId: outcome.result.queueId });
    } else if (delivery.status === "failed") {
      audit(auth.user.id, "message.failed", { queueId: outcome.result.queueId }, "warning");
    }

    return ok({
      ...outcome.result,
      // The real state, never optimistic.
      status: delivery.status === "sent" ? "sent" : outcome.result.status,
      delivery,
      transportConfigured: transportConfigured(),
    });
  });
}
