import { currentSessionId, revokeSession } from "@/lib/server/account";
import { audit } from "@/lib/server/auth";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/account/sessions/:id — sign out one device.
 *
 * Ownership is part of the UPDATE's WHERE clause, so another user's session id
 * changes zero rows and returns 404. As with attachments, 404 rather than 403:
 * a 403 confirms the session exists.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const ownSession = await currentSessionId();

    if (id === ownSession) {
      // Revoking your own session here would sign you out through a control
      // labelled "sign out this other device". Sign out is its own action.
      return fail(
        400,
        "cannot_revoke_current",
        "This is the session you are using. Use Sign out instead."
      );
    }

    if (!revokeSession(auth.user.id, id)) {
      return fail(404, "session_not_found", "That session no longer exists.");
    }

    audit(auth.user.id, "session.revoked", { sessionId: id }, "warning");
    return ok({ revoked: 1 });
  });
}
