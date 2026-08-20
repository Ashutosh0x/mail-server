import type { NextRequest } from "next/server";
import { finishAuthentication } from "@/lib/server/webauthn";
import { audit, createSession, setSessionCookie } from "@/lib/server/auth";
import { db, nowIso } from "@/lib/server/db";
import { guard, ok, fail } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/passkey — complete a passkey sign-in.
 *
 * On success this creates a session exactly as a password sign-in does. The
 * passkey replaces the password; everything downstream is unchanged.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Send the authenticator response.");

    const ip = request.headers.get("x-forwarded-for");
    const userAgent = request.headers.get("user-agent");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await finishAuthentication(body as any);

    if (!result.ok) {
      const malformed = result.reason.includes("malformed");
      // Only a real credential rejection is a security event worth recording;
      // a malformed body is a client bug, and logging it as a failed sign-in
      // would fill the audit trail with noise.
      if (!malformed) {
        // Recorded without a user id — we genuinely do not know who this was.
        audit(null, "auth.failed", { method: "passkey" }, "warning", { ip, userAgent });
      }
      return fail(malformed ? 400 : 401, malformed ? "invalid_body" : "passkey_rejected", result.reason);
    }

    db().prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(nowIso(), result.userId);

    const { token } = createSession(result.userId, { ip, userAgent });
    await setSessionCookie(token);
    audit(result.userId, "auth.login", { method: "passkey", passkeyId: result.passkeyId }, "info", {
      ip,
      userAgent,
    });

    return ok({ user: { id: result.userId } });
  });
}
