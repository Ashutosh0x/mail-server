import { guard, ok, fail, requireUser } from "@/lib/server/http";
import { getThread } from "@/lib/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { threadId } = await context.params;
    const result = getThread(auth.user.id, threadId);
    // 404 rather than 403 for another user's thread: distinguishing them tells
    // the caller the id exists, which is the whole of an IDOR probe.
    if (!result) return fail(404, "not_found", "That conversation does not exist.");
    return ok(result);
  });
}
