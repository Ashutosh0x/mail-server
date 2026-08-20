import type { NextRequest } from "next/server";
import { storageUsage } from "@/lib/server/account";
import {
  cleanupReport,
  deleteAttachments,
  deleteMessages,
  emptyMailbox,
  orphanedAttachments,
  recordCleanup,
} from "@/lib/server/storage-cleanup";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/storage/cleanup — what is taking up space.
 *
 * Read-only, so the client can call it to refresh after a deletion. Every
 * figure is a live query; nothing is cached and nothing is estimated.
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const days = Number(request.nextUrl.searchParams.get("olderThanDays") ?? 365);
    const olderThanDays = Number.isFinite(days) ? Math.min(3650, Math.max(1, days)) : 365;

    return ok({
      report: cleanupReport(auth.user.id, olderThanDays),
      orphans: orphanedAttachments(auth.user.id),
      storage: storageUsage(auth.user.id),
    });
  });
}

type Action = "deleteAttachments" | "deleteMessages" | "emptyTrash" | "emptySpam" | "deleteOrphans";

const ACTIONS: Action[] = [
  "deleteAttachments",
  "deleteMessages",
  "emptyTrash",
  "emptySpam",
  "deleteOrphans",
];

/**
 * POST /api/account/storage/cleanup — delete, permanently.
 *
 * Everything this does is irreversible, so it is deliberately narrow:
 *
 *   - The user is taken from the session. Ids in the body select nothing that
 *     is not already theirs, because ownership is in every WHERE clause.
 *   - Only Trash and Spam can be emptied wholesale. "Empty Inbox" is not a
 *     cleanup tool.
 *   - The response reports what was ACTUALLY deleted and lists what failed.
 *     A partial failure is a partial success, never a reported success.
 *   - Fresh storage totals come back with it, so the page cannot show a stale
 *     figure after a deletion.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Send a JSON object.");

    const action = typeof body.action === "string" ? (body.action as Action) : null;
    if (!action || !ACTIONS.includes(action)) {
      return fail(400, "invalid_action", "That is not a cleanup action.");
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((value): value is string => typeof value === "string")
      : [];

    let outcome;
    switch (action) {
      case "deleteAttachments":
        if (ids.length === 0) return fail(400, "nothing_selected", "Select at least one attachment.");
        outcome = await deleteAttachments(auth.user.id, ids);
        break;
      case "deleteMessages":
        if (ids.length === 0) return fail(400, "nothing_selected", "Select at least one message.");
        outcome = await deleteMessages(auth.user.id, ids);
        break;
      case "emptyTrash":
        outcome = await emptyMailbox(auth.user.id, "trash");
        break;
      case "emptySpam":
        outcome = await emptyMailbox(auth.user.id, "junk");
        break;
      case "deleteOrphans":
        outcome = await deleteAttachments(auth.user.id, orphanedAttachments(auth.user.id).ids);
        break;
    }

    recordCleanup(auth.user.id, `storage.${action}`, {
      deleted: outcome.deleted,
      freedBytes: outcome.freedBytes,
      failed: outcome.failures.length,
    });

    return ok({
      action,
      deleted: outcome.deleted,
      freedBytes: outcome.freedBytes,
      failures: outcome.failures,
      // Recomputed, not adjusted client-side, so the number shown is the
      // number the database holds.
      storage: storageUsage(auth.user.id),
    });
  });
}
