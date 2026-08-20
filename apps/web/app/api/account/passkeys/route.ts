import type { NextRequest } from "next/server";
import { listPasskeys } from "@/lib/server/account";
import { finishRegistration } from "@/lib/server/webauthn";
import { audit } from "@/lib/server/auth";
import { isHeaderSafe } from "@/lib/server/validate";
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
 * POST /api/account/passkeys — finish registering a passkey.
 *
 * The attestation is verified against the challenge THIS server issued to
 * THIS user, and the challenge is consumed in the process so the same
 * response cannot be replayed.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.response !== "object" || body.response === null) {
      return fail(400, "invalid_body", "Send the authenticator response.");
    }

    // A name the user will recognise later. Trimmed and bounded, and never
    // rendered as anything but text.
    const raw = typeof body.name === "string" ? body.name.trim() : "";
    const name = raw.length > 0 && raw.length <= 60 ? raw : "Passkey";
    if (!isHeaderSafe(name)) {
      return fail(400, "invalid_name", "That name contains characters that are not allowed.");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await finishRegistration(auth.user.id, body.response as any, name);
    if (!result.ok) {
      const malformed = result.reason.includes("malformed");
      return fail(400, malformed ? "invalid_body" : "passkey_rejected", result.reason);
    }

    audit(auth.user.id, "passkey.created", { passkeyId: result.id }, "warning", {
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return ok({ passkeys: listPasskeys(auth.user.id) }, 201);
  });
}
