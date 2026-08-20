import { currentSessionId, revokeOtherSessions } from "@/lib/server/account";
import { audit } from "@/lib/server/auth";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/sessions/revoke-all — sign out everywhere else.
 *
 * Keeps the caller's own session. Someone reacting to a device they do not
 * recognise wants that device gone, not to be logged out mid-response and left
 * unsure whether it worked.
 */
export async function POST() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const keep = await currentSessionId();
    const revoked = revokeOtherSessions(auth.user.id, keep);

    audit(auth.user.id, "session.revoked", { scope: "all_other", revoked }, "warning");
    return ok({ revoked });
  });
}
