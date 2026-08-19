import { listPasskeys } from "@/lib/server/account";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/passkeys — registered passkeys.
 *
 * `credential_id` and `public_key` are not in the response shape at all. The
 * user needs to recognise and revoke a passkey, which needs a name and two
 * dates; the credential material is the server's.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return ok({ passkeys: listPasskeys(auth.user.id) });
  });
}

/**
 * POST /api/account/passkeys — not implemented.
 *
 * Registration is a WebAuthn ceremony: a server-issued challenge, an
 * attestation the client returns, CBOR/COSE parsing, origin and RP-ID
 * verification, and a sign-count check on every later assertion. None of that
 * exists. Writing a row here without it would produce a passkey that cannot
 * authenticate anyone, listed on a security screen as though it protects them.
 */
export async function POST() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return fail(
      501,
      "webauthn_not_implemented",
      "Adding a passkey needs WebAuthn registration, which is not built yet."
    );
  });
}
