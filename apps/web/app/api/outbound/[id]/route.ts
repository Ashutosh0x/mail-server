import { queueStatus } from "@/lib/server/compose";
import { transportConfigured } from "@/lib/server/transport";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/outbound/:id — the real state of a queued message.
 *
 * Scoped by user in the query, so another user's queue id returns 404.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const entry = queueStatus(auth.user.id, id);
    if (!entry) return fail(404, "not_found", "No such message.");

    return ok({
      queue: entry,
      // So the UI can explain why something sits at `queued` rather than
      // implying it is stuck or lost.
      transportConfigured: transportConfigured(),
    });
  });
}
