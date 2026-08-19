import { currentSessionId, listSessions } from "@/lib/server/account";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/sessions — active sessions for the caller.
 *
 * Never exposes `token_hash`. The list is what the user needs to recognise a
 * device; the hash would let anyone reading a response impersonate one.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return ok({ sessions: listSessions(auth.user.id, await currentSessionId()) });
  });
}
