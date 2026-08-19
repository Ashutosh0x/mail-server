import { accountProfile, securityPosture, storageUsage } from "@/lib/server/account";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account — everything the profile menu needs, in one request.
 *
 * Bundled deliberately: the menu opens on a click and needs identity, security
 * posture and storage together. Three round trips would render it in three
 * stages, and a security indicator that arrives late is one the user has
 * already stopped looking at.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const profile = accountProfile(auth.user.id);
    if (!profile) {
      // The session resolved but the row is gone. Fail rather than invent one.
      return fail(404, "account_not_found", "This account no longer exists.");
    }

    return ok({
      profile,
      security: securityPosture(auth.user.id),
      storage: storageUsage(auth.user.id),
      /**
       * Named so the client renders "not built" instead of a control that
       * cannot work. Every one of these is absent, not broken.
       */
      unavailable: {
        accountSwitching: "Multiple accounts are not supported yet.",
        passkeyEnrolment: "Adding a passkey needs WebAuthn, which is not built yet.",
        mfaEnrolment: "Two-factor enrolment is not built yet.",
        connectedApps: "There is no OAuth server, so no application can be connected.",
        apiKeys: "API key issuance is not built yet.",
      },
    });
  });
}
