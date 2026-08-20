import type { NextRequest } from "next/server";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { applyAction, type MessageAction } from "@/lib/server/mail";
import { deleteMessages, recordCleanup } from "@/lib/server/storage-cleanup";
import { audit } from "@/lib/server/auth";

export const runtime = "nodejs";

const ACTIONS: MessageAction[] = ["read", "unread", "star", "unstar", "archive", "trash", "restore", "spam", "delete"];

/**
 * `purge` is not a `MessageAction` because it is not a state change.
 *
 * Everything in ACTIONS moves a row or flips a flag, and all of it is
 * reversible. Purge destroys the row and its bytes, so it takes a different
 * code path — the one in storage-cleanup that deletes blobs before records and
 * reports partial failure — rather than becoming a tenth case in a switch where
 * it would look like a sibling of "archive".
 */
type Operation = MessageAction | "purge";

/**
 * POST /api/mail/actions — apply one operation to a set of messages.
 *
 * Bulk by design: archiving fifty messages is one transaction and one round
 * trip, not fifty of each. The response reports how many rows actually changed
 * so an optimistic UI can reconcile rather than assume.
 *
 * The client's list of ids is never trusted. `applyAction` and `deleteMessages`
 * both carry `user_id` in their WHERE clauses, so an id belonging to someone
 * else matches nothing — and `changed` comes back lower than `requested`,
 * which is exactly the signal the UI needs.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action as Operation;
    if (action !== "purge" && !ACTIONS.includes(action)) {
      return fail(400, "invalid_action", `Action must be one of: ${[...ACTIONS, "purge"].join(", ")}.`);
    }

    const ids = body?.messageIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
      return fail(400, "invalid_ids", "Provide at least one message id.");
    }
    if (ids.length > 500) {
      return fail(400, "too_many", "Apply an action to at most 500 messages at a time.");
    }

    if (action === "purge") {
      // Reuses the cleanup path rather than duplicating deletion logic: blobs
      // go before rows, a blob that will not delete leaves its message intact,
      // and the caller is told what actually failed.
      const outcome = await deleteMessages(auth.user.id, ids as string[]);
      recordCleanup(auth.user.id, "mail.purge", {
        requested: ids.length,
        deleted: outcome.deleted,
        freedBytes: outcome.freedBytes,
        failed: outcome.failures.length,
      });

      return ok({
        changed: outcome.deleted,
        requested: ids.length,
        freedBytes: outcome.freedBytes,
        // Never rounded up to success. A partial failure is reported as one.
        failures: outcome.failures,
      });
    }

    const changed = applyAction(auth.user.id, ids as string[], action);
    audit(auth.user.id, `mail.${action}`, { requested: ids.length, changed });
    return ok({ changed, requested: ids.length });
  });
}
