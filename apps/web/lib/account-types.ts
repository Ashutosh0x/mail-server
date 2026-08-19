/**
 * Client-side shapes for the account center.
 *
 * Mirrors what `lib/server/account.ts` returns. Kept in its own module rather
 * than imported from the server file so nothing under `components/` pulls in
 * `server-only`.
 */

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

/**
 * `unavailable` is not a failure state. It means the control has no
 * implementation behind it, so the UI must not offer it as something the user
 * can fix — and must not count it as protection either.
 */
export type CheckState = "satisfied" | "missing" | "unavailable";

export interface SecurityCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

export interface SecurityPosture {
  score: number;
  satisfied: number;
  applicable: number;
  protected: boolean;
  checks: SecurityCheck[];
  activeSessions: number;
}

export interface SessionRecord {
  id: string;
  current: boolean;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

export interface StorageUsage {
  quotaBytes: number;
  usedBytes: number;
  percentUsed: number;
  breakdown: { id: string; label: string; bytes: number }[];
}

export interface Preferences {
  appearance: {
    theme: "light" | "dark" | "system";
    density: "compact" | "comfortable" | "spacious";
    reducedMotion: boolean;
    messagePreview: boolean;
  };
  notifications: {
    desktop: boolean;
    sound: boolean;
    newMail: boolean;
    mentions: boolean;
    securityAlerts: boolean;
  };
  privacy: {
    remoteImages: "block" | "ask" | "always";
    trackingProtection: boolean;
    linkProtection: boolean;
    aiProcessing: "off" | "local" | "approved";
    telemetry: boolean;
  };
}

export interface PasskeyRecord {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  severity: string;
  createdAt: string;
  ipAddress: string | null;
}

/**
 * Why a capability is not offered.
 *
 * The server sends the reason so the client renders "not built, because X"
 * rather than a disabled button with no explanation — or worse, an enabled one
 * that fails.
 */
export interface UnavailableFeatures {
  accountSwitching: string;
  passkeyEnrolment: string;
  mfaEnrolment: string;
  connectedApps: string;
  apiKeys: string;
}

export interface AccountOverview {
  profile: AccountProfile;
  security: SecurityPosture;
  storage: StorageUsage;
  unavailable: UnavailableFeatures;
}
