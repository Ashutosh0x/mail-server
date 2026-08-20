import { beginRegistration } from "@/lib/server/webauthn";
import { accountProfile } from "@/lib/server/account";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/passkeys/challenge — start registering a passkey.
 *
 * Authenticated: you can only add a passkey to the account you are signed in
 * to. The challenge is stored server-side against that user, so an options
 * blob obtained here cannot be used to enrol a key on someone else's account.
 */
export async function POST() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const profile = accountProfile(auth.user.id);
    if (!profile) return fail(404, "account_not_found", "This account no longer exists.");

    const options = await beginRegistration({
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
    });

    return ok({ options });
  });
}
