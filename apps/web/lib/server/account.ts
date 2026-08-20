import "server-only";
import { db, nowIso } from "./db";
import { config } from "./config";
import { describeUserAgent, DEFAULT_PREFERENCES, type DeviceType } from "../account-defaults";
import type { Preferences } from "../account-types";

export { currentSessionId } from "./auth";
export { describeUserAgent, DEFAULT_PREFERENCES } from "../account-defaults";

/**
 * The account data layer.
 *
 * Every function takes `userId` and scopes on it, for the same reason the mail
 * layer does: there is no unscoped variant to call by accident.
 *
 * What this file will NOT do is invent a posture. `securityPosture()` reports
 * what the database actually contains — if a control has no implementation,
 * it is reported as `unavailable`, never as "missing" (which implies the user
 * could fix it) and never as satisfied. A security screen that overstates a
 * user's protection is worse than no screen at all.
 */

// ── Profile ────────────────────────────────────────────────────────────────

export interface AccountProfile {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  timezone: string;
  language: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  organization: { id: string; name: string } | null;
}

export function accountProfile(userId: string): AccountProfile | null {
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.timezone, u.language,
              u.email_verified, u.created_at, u.last_login_at,
              t.id AS tenant_id, t.name AS tenant_name
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = ?`
    )
    .get(userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    role: row.role as string,
    status: row.status as string,
    timezone: row.timezone as string,
    language: row.language as string,
    emailVerified: Number(row.email_verified) === 1,
    createdAt: row.created_at as string,
    lastLoginAt: (row.last_login_at as string | null) ?? null,
    organization: row.tenant_id
      ? { id: row.tenant_id as string, name: (row.tenant_name as string) ?? "" }
      : null,
  };
}

export interface ProfilePatch {
  displayName?: string;
  timezone?: string;
  language?: string;
}

export function updateProfile(userId: string, patch: ProfilePatch): void {
  const sets: string[] = [];
  // Typed as string, not unknown: every column touched here is TEXT, and the
  // driver rejects an unknown-typed spread.
  const values: string[] = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(patch.displayName);
  }
  if (patch.timezone !== undefined) {
    sets.push("timezone = ?");
    values.push(patch.timezone);
  }
  if (patch.language !== undefined) {
    sets.push("language = ?");
    values.push(patch.language);
  }
  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  values.push(nowIso(), userId);
  db().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

// ── Security posture ───────────────────────────────────────────────────────

/**
 * `unavailable` exists because some controls in the design have no
 * implementation behind them yet. Reporting those as `missing` would tell a
 * user to go and enable something that does not exist, and counting them as
 * satisfied would overstate their protection. Both are worse than saying so.
 */
export type CheckState = "satisfied" | "missing" | "unavailable";

export interface SecurityCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

export interface SecurityPosture {
  /** Satisfied checks over checks that CAN be satisfied today. */
  score: number;
  satisfied: number;
  applicable: number;
  protected: boolean;
  checks: SecurityCheck[];
  activeSessions: number;
}

export function securityPosture(userId: string): SecurityPosture {
  const user = db()
    .prepare(`SELECT password_hash, mfa_enabled FROM users WHERE id = ?`)
    .get(userId) as { password_hash: string | null; mfa_enabled: number } | undefined;

  const passkeyCount = Number(
    (db().prepare(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?`).get(userId) as { n: number }).n
  );

  const activeSessions = Number(
    (
      db()
        .prepare(
          `SELECT COUNT(*) AS n FROM sessions
            WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`
        )
        .get(userId, nowIso()) as { n: number }
    ).n
  );

  const checks: SecurityCheck[] = [
    {
      id: "password",
      label: "Strong password",
      state: user?.password_hash ? "satisfied" : "missing",
      detail: user?.password_hash
        ? "Hashed with scrypt."
        : "No password is set on this account.",
    },
    {
      id: "passkey",
      label: "Passkey",
      state: passkeyCount > 0 ? "satisfied" : "missing",
      detail:
        passkeyCount > 0
          ? `${passkeyCount} passkey${passkeyCount === 1 ? "" : "s"} registered.`
          : "Registration needs WebAuthn, which is not built yet.",
    },
    {
      id: "mfa",
      label: "Two-factor authentication",
      state: Number(user?.mfa_enabled ?? 0) === 1 ? "satisfied" : "missing",
      detail:
        Number(user?.mfa_enabled ?? 0) === 1
          ? "A second factor is required at sign-in."
          : "Enrolment is not built yet.",
    },
    {
      id: "recovery",
      // No recovery_codes table exists, so this cannot be satisfied or fixed.
      // Saying "missing" would send the user looking for a control that is not
      // there.
      label: "Recovery methods",
      state: "unavailable",
      detail: "Recovery codes are not implemented.",
    },
  ];

  const applicableChecks = checks.filter((check) => check.state !== "unavailable");
  const satisfied = applicableChecks.filter((check) => check.state === "satisfied").length;
  const applicable = applicableChecks.length;

  return {
    score: applicable === 0 ? 0 : Math.round((satisfied / applicable) * 100),
    satisfied,
    applicable,
    // "Protected" is a claim, so it needs every applicable control satisfied.
    protected: applicable > 0 && satisfied === applicable,
    checks,
    activeSessions,
  };
}

// ── Sessions and devices ───────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  current: boolean;
  browser: string;
  os: string;
  deviceType: DeviceType;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

export function listSessions(userId: string, currentId: string | null): SessionRecord[] {
  const rows = db()
    .prepare(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at
         FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY last_seen_at DESC, created_at DESC`
    )
    .all(userId, nowIso()) as Record<string, unknown>[];

  return rows.map((row) => {
    const described = describeUserAgent((row.user_agent as string | null) ?? null);
    return {
      id: row.id as string,
      current: row.id === currentId,
      browser: described.browser,
      os: described.os,
      deviceType: described.deviceType,
      ipAddress: (row.ip_address as string | null) ?? null,
      createdAt: row.created_at as string,
      lastSeenAt: (row.last_seen_at as string | null) ?? null,
      expiresAt: row.expires_at as string,
    };
  });
}

/**
 * Revoke one session. Ownership is part of the WHERE clause, so passing another
 * user's session id changes zero rows rather than revoking it.
 */
export function revokeSession(userId: string, sessionId: string): boolean {
  const result = db()
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(nowIso(), sessionId, userId);
  return Number(result.changes) > 0;
}

/** Sign out everywhere else, keeping the caller signed in. */
export function revokeOtherSessions(userId: string, keepSessionId: string | null): number {
  const result = keepSessionId
    ? db()
        .prepare(
          `UPDATE sessions SET revoked_at = ?
            WHERE user_id = ? AND id != ? AND revoked_at IS NULL`
        )
        .run(nowIso(), userId, keepSessionId)
    : db()
        .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
        .run(nowIso(), userId);
  return Number(result.changes);
}

// ── Storage ────────────────────────────────────────────────────────────────

export interface StorageUsage {
  quotaBytes: number;
  usedBytes: number;
  percentUsed: number;
  breakdown: { id: string; label: string; bytes: number }[];
}

/**
 * Real usage, summed per request from the rows that exist.
 *
 * `users.used_bytes` is a denormalised counter and can drift; these two sums
 * are the ground truth, so they are what the user is shown.
 */
export function storageUsage(userId: string): StorageUsage {
  const quotaRow = db()
    .prepare(`SELECT quota_bytes FROM users WHERE id = ?`)
    .get(userId) as { quota_bytes: number } | undefined;

  const mailBytes = Number(
    (
      db()
        .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS n FROM messages WHERE user_id = ?`)
        .get(userId) as { n: number }
    ).n
  );

  const attachmentBytes = Number(
    (
      db()
        .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS n FROM attachments WHERE user_id = ?`)
        .get(userId) as { n: number }
    ).n
  );

  const quotaBytes = Number(quotaRow?.quota_bytes ?? config.maxUserStorageBytes);
  const usedBytes = mailBytes + attachmentBytes;

  return {
    quotaBytes,
    usedBytes,
    percentUsed: quotaBytes === 0 ? 0 : Math.min(100, (usedBytes / quotaBytes) * 100),
    breakdown: [
      { id: "mail", label: "Mail", bytes: mailBytes },
      { id: "attachments", label: "Attachments", bytes: attachmentBytes },
    ],
  };
}

// ── Preferences ────────────────────────────────────────────────────────────

/**
 * Preferences live in `users.settings` as JSON. The shape and the defaults are
 * in `lib/account-defaults.ts` so the client can share them.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One level of merge per section, keeping only keys the defaults define. */
function mergeSection<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
  if (!isRecord(stored)) return { ...defaults };
  const merged = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = stored[key as string];
    if (value === undefined) continue;
    if (typeof value === typeof defaults[key]) merged[key] = value as T[keyof T];
  }
  return merged;
}

export function preferences(userId: string): Preferences {
  const row = db().prepare(`SELECT settings FROM users WHERE id = ?`).get(userId) as
    | { settings: string }
    | undefined;

  let stored: unknown = {};
  try {
    stored = JSON.parse(row?.settings ?? "{}");
  } catch {
    // A corrupt settings blob must not break the account screen. Defaults are
    // safe, so fall back rather than throwing.
    stored = {};
  }
  if (!isRecord(stored)) stored = {};
  const source = stored as Record<string, unknown>;

  return {
    appearance: mergeSection(DEFAULT_PREFERENCES.appearance, source.appearance),
    notifications: mergeSection(DEFAULT_PREFERENCES.notifications, source.notifications),
    privacy: mergeSection(DEFAULT_PREFERENCES.privacy, source.privacy),
  };
}

export function updatePreferences(userId: string, patch: unknown): Preferences {
  const current = preferences(userId);
  const source = isRecord(patch) ? patch : {};

  const next: Preferences = {
    appearance: mergeSection(current.appearance, source.appearance),
    notifications: mergeSection(current.notifications, source.notifications),
    privacy: mergeSection(current.privacy, source.privacy),
  };

  db()
    .prepare(`UPDATE users SET settings = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(next), nowIso(), userId);

  return next;
}

// ── Passkeys ───────────────────────────────────────────────────────────────

export interface PasskeyRecord {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * List registered passkeys. Note what is absent: `credential_id` and
 * `public_key` never leave the server.
 */
export function listPasskeys(userId: string): PasskeyRecord[] {
  const rows = db()
    .prepare(
      `SELECT id, name, created_at, last_used_at FROM passkeys
        WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
  }));
}

export function revokePasskey(userId: string, passkeyId: string): boolean {
  const result = db()
    .prepare(`DELETE FROM passkeys WHERE id = ? AND user_id = ?`)
    .run(passkeyId, userId);
  return Number(result.changes) > 0;
}

// ── Audit trail ────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  /** The machine code, verbatim. Never translated on the way out of the DB. */
  action: string;
  severity: string;
  createdAt: string;
  ipAddress: string | null;
  /** Null for any event recorded before audit() captured request context. */
  browser: string | null;
  os: string | null;
  deviceType: DeviceType | null;
}

export function recentAudit(userId: string, limit = 20): AuditEntry[] {
  const rows = db()
    .prepare(
      `SELECT id, action, severity, created_at, ip_address, user_agent FROM audit_logs
        WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, Math.min(limit, 100)) as Record<string, unknown>[];

  return rows.map((row) => {
    const ua = (row.user_agent as string | null) ?? null;
    // Only describe a device when one was actually recorded. Every event
    // written before audit() captured request context has none, and the UI
    // shows "Not available" rather than inventing a plausible browser.
    const described = ua ? describeUserAgent(ua) : null;
    return {
      id: row.id as string,
      action: row.action as string,
      severity: row.severity as string,
      createdAt: row.created_at as string,
      ipAddress: (row.ip_address as string | null) ?? null,
      browser: described?.browser ?? null,
      os: described?.os ?? null,
      deviceType: described?.deviceType ?? null,
    };
  });
}
