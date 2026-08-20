import type { NextRequest } from "next/server";
import { beginAuthentication } from "@/lib/server/webauthn";
import { guard, ok } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/passkey/challenge — start signing in with a passkey.
 *
 * Unauthenticated by necessity. An email may be supplied to narrow the
 * credential list, but the response is deliberately identical whether or not
 * that address exists: an empty `allowCredentials` would confirm the account,
 * so an unknown address simply gets an unfiltered challenge and the
 * authenticator finds nothing to offer.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" && body.email.trim() ? body.email.trim() : null;

    const options = await beginAuthentication(email);
    return ok({ options });
  });
}
