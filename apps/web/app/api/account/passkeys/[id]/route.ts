import { revokePasskey } from "@/lib/server/account";
import { audit } from "@/lib/server/auth";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/account/passkeys/:id — revoke a passkey.
 *
 * Real even though registration is not: a credential that must be removed
 * (a lost security key) has to be removable regardless of how it got there.
 * Ownership is in the WHERE clause, so another user's id deletes nothing.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    if (!revokePasskey(auth.user.id, id)) {
      return fail(404, "passkey_not_found", "That passkey no longer exists.");
    }

    audit(auth.user.id, "passkey.revoked", { passkeyId: id }, "warning");
    return ok({ revoked: 1 });
  });
}
