import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, newId, nowIso } from "./db";
import { config } from "./config";

/**
 * Passwords and sessions.
 *
 * scrypt from `node:crypto` rather than Argon2id, which the plan specifies:
 * Argon2 needs a native module, and this environment cannot compile one.
 * scrypt is memory-hard, in the standard library, and FIPS-adjacent — a real
 * choice, not a placeholder. The stored format carries its own parameters, so
 * moving to Argon2id later can rehash on next login without a migration.
 */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 } as const;

/**
 * scrypt needs 128 * N * r bytes — 32 MiB at these parameters, which is exactly
 * Node's default `maxmem` and so fails by a margin of the implementation's own
 * overhead. Raised rather than dropping N: the work factor IS the protection,
 * and halving it to fit a default would be tuning security to a config value.
 */
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;
const SESSION_COOKIE = "mf_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Constant-time verification.
 *
 * Returns false for a malformed record rather than throwing: a corrupt row must
 * fail the login, not 500 the endpoint and reveal that the account exists.
 */
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64!, "base64");
    const expected = Buffer.from(hashB64!, "base64");
    // Parameters come from the stored record, so an old hash still verifies
    // after the defaults change. maxmem is derived from them for the same
    // reason.
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    const actual = scryptSync(password, salt, expected.length, {
      ...params,
      maxmem: 128 * params.N * params.r * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Session tokens are stored hashed — see the schema note. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string;
  quotaBytes: number;
  usedBytes: number;
}

export function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): { token: string; expiresAt: string } {
  // 32 bytes of CSPRNG. Never Math.random, and never a predictable id.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString();

  db()
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(newId(), userId, hashToken(token), meta.ip ?? null, meta.userAgent ?? null, expiresAt, nowIso(), nowIso());

  return { token, expiresAt };
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure only over HTTPS: forcing it on plain-HTTP localhost means the
    // cookie is silently dropped and login appears to do nothing.
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionTtlSeconds,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Expired and revoked sessions resolve to null. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role, u.tenant_id, u.quota_bytes, u.used_bytes, s.id AS session_id
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.status = 'active'`
    )
    .get(hashToken(token), nowIso()) as Record<string, unknown> | undefined;

  if (!row) return null;

  db().prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(), row.session_id as string);

  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    role: row.role as string,
    tenantId: row.tenant_id as string,
    quotaBytes: Number(row.quota_bytes),
    usedBytes: Number(row.used_bytes),
  };
}

export async function revokeCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  db().prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`).run(nowIso(), hashToken(token));
}

/** "Log out everywhere". */
export function revokeAllSessions(userId: string): number {
  const result = db()
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(nowIso(), userId);
  return Number(result.changes);
}

export function audit(
  userId: string | null,
  action: string,
  details: Record<string, unknown> = {},
  severity: "info" | "warning" | "critical" = "info"
): void {
  db()
    .prepare(
      `INSERT INTO audit_logs (id, user_id, action, details, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(newId(), userId, action, JSON.stringify(details), severity, nowIso());
}
