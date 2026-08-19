import type { NextRequest } from "next/server";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { applyAction, type MessageAction } from "@/lib/server/mail";
import { audit } from "@/lib/server/auth";

export const runtime = "nodejs";

const ACTIONS: MessageAction[] = ["read", "unread", "star", "unstar", "archive", "trash", "restore", "spam", "delete"];

/**
 * POST /api/mail/actions — apply one action to a set of messages.
 *
 * Bulk by design: archiving fifty messages is one transaction and one round
 * trip, not fifty of each. The response reports how many rows actually changed
 * so an optimistic UI can reconcile rather than assume.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action as MessageAction;
    if (!ACTIONS.includes(action)) {
      return fail(400, "invalid_action", `Action must be one of: ${ACTIONS.join(", ")}.`);
    }

    const ids = body?.messageIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
      return fail(400, "invalid_ids", "Provide at least one message id.");
    }
    if (ids.length > 500) {
      return fail(400, "too_many", "Apply an action to at most 500 messages at a time.");
    }

    const changed = applyAction(auth.user.id, ids as string[], action);
    audit(auth.user.id, `mail.${action}`, { requested: ids.length, changed });
    return ok({ changed, requested: ids.length });
  });
}
