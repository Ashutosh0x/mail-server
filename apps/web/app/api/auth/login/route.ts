import type { NextRequest } from "next/server";
import { findByEmail } from "@/lib/server/accounts";
import { audit, createSession, setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { db, newId, nowIso } from "@/lib/server/db";
import { fail, guard, ok } from "@/lib/server/http";
import { isEmail } from "@/lib/server/validate";

export const runtime = "nodejs";

/** Attempts allowed per address per window, before the endpoint stops trying. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function recentFailures(email: string): number {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM security_events
        WHERE event_type = 'login_failed' AND target_user = ? AND created_at > ?`
    )
    .get(email, since) as { n: number };
  return Number(row.n);
}

function recordFailure(email: string, ip: string | null) {
  db()
    .prepare(
      `INSERT INTO security_events (id, event_type, source_ip, target_user, details, severity, created_at)
       VALUES (?, 'login_failed', ?, ?, '{}', 'warning', ?)`
    )
    .run(newId(), ip, email, nowIso());
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Expected a JSON body.");

    const email = typeof body.email === "string" ? body.email.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const ip = request.headers.get("x-forwarded-for");

    if (!isEmail(email) || password.length === 0) {
      return fail(400, "invalid_credentials", "Enter your email address and password.");
    }

    if (recentFailures(email) >= MAX_ATTEMPTS) {
      // Locking on the ADDRESS, not the IP: an attacker rotates IPs, and the
      // account is what needs protecting.
      return fail(429, "too_many_attempts", "Too many sign-in attempts. Try again in 15 minutes.");
    }

    const user = findByEmail(email);
    const valid = verifyPassword(password, user?.password_hash ?? null);

    // One message for "no such account" and "wrong password". Distinguishing
    // them turns this endpoint into a way to enumerate who has an account.
    if (!user || !valid || user.status !== "active") {
      recordFailure(email, ip);
      return fail(401, "invalid_credentials", "That email address or password is incorrect.");
    }

    const { token } = createSession(user.id, { ip, userAgent: request.headers.get("user-agent") });
    await setSessionCookie(token);
    db().prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(nowIso(), user.id);
    audit(user.id, "auth.login", {}, "info", { ip, userAgent: request.headers.get("user-agent") });

    return ok({ user: { id: user.id, email: user.email } });
  });
}
