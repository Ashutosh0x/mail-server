import { currentSessionId, listSessions, recentAudit, securityPosture } from "@/lib/server/account";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/security — the Security Center's data.
 *
 * Posture, live sessions and the audit trail together, because the question a
 * user opens this screen with ("is anything wrong?") is answered by all three
 * at once.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const sessionId = await currentSessionId();

    return ok({
      posture: securityPosture(auth.user.id),
      sessions: listSessions(auth.user.id, sessionId),
      activity: recentAudit(auth.user.id, 20),
    });
  });
}
