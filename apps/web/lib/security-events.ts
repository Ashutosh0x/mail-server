import { icons, type LucideIcon } from "@mailserver/ui";
import type { AuditEntry } from "./account-types";

/**
 * Presentation for audit events.
 *
 * The backend stores machine codes and this is the only place they become
 * English. Translating on the way into the database would destroy the
 * structure the audit trail exists to preserve; translating here means the
 * raw code is always still available for a diagnostics view.
 *
 * Two naming conventions exist in real history. Earlier code wrote
 * SCREAMING_SNAKE (`PROFILE_UPDATED`), newer code writes `namespace.verb`
 * (`profile.updated`). Both are mapped, because those older rows are genuine
 * events and deleting or rewriting them to tidy the UI would be falsifying an
 * audit log.
 */

export interface EventPresentation {
  label: string;
  /** Second line. Empty when there is nothing true to add. */
  description: string;
  icon: LucideIcon;
  /** Drives the dot colour on the timeline. */
  tone: "neutral" | "positive" | "attention";
}

const KNOWN: Record<string, Omit<EventPresentation, "icon"> & { icon: LucideIcon }> = {
  "auth.login": {
    label: "Signed in",
    description: "",
    icon: icons.chrome.signIn,
    tone: "neutral",
  },
  "auth.logout": {
    label: "Signed out",
    description: "",
    icon: icons.chrome.signOut,
    tone: "neutral",
  },
  "auth.failed": {
    label: "Failed sign-in attempt",
    description: "Someone entered an incorrect password.",
    icon: icons.status.warning,
    tone: "attention",
  },
  "account.created": {
    label: "Account created",
    description: "",
    icon: icons.contacts.add,
    tone: "positive",
  },
  "profile.updated": {
    label: "Profile updated",
    description: "Your profile information was changed.",
    icon: icons.account.profile,
    tone: "neutral",
  },
  "preferences.updated": {
    label: "Preferences updated",
    description: "A privacy or notification setting was changed.",
    icon: icons.settings.general,
    tone: "neutral",
  },
  "password.changed": {
    label: "Password changed",
    description: "",
    icon: icons.security.key,
    tone: "attention",
  },
  "session.revoked": {
    label: "Session signed out",
    description: "A device was signed out of this account.",
    icon: icons.security.revokeSession,
    tone: "attention",
  },
  "passkey.created": {
    label: "Passkey added",
    description: "",
    icon: icons.security.passkey,
    tone: "positive",
  },
  "passkey.revoked": {
    label: "Passkey removed",
    description: "",
    icon: icons.security.passkey,
    tone: "attention",
  },
  "mfa.enabled": {
    label: "Two-factor authentication enabled",
    description: "",
    icon: icons.security.verified,
    tone: "positive",
  },
  "mfa.disabled": {
    label: "Two-factor authentication disabled",
    description: "",
    icon: icons.security.unconfigured,
    tone: "attention",
  },
};

/** Rows written before the naming convention settled. Same events, older codes. */
const LEGACY_ALIASES: Record<string, string> = {
  PROFILE_UPDATED: "profile.updated",
  SESSION_REVOKED: "session.revoked",
  PASSKEY_CREATED: "passkey.created",
  PASSKEY_REVOKED: "passkey.revoked",
  MFA_ENABLED: "mfa.enabled",
  MFA_DISABLED: "mfa.disabled",
  PASSWORD_CHANGED: "password.changed",
  SESSION_CREATED: "auth.login",
  ACCOUNT_SIGNED_OUT: "auth.logout",
};

/**
 * Describe one event.
 *
 * An unrecognised code is shown as itself rather than hidden. An audit trail
 * that silently drops events it does not recognise is not an audit trail, and
 * the unknown code is exactly what a reader needs in order to ask about it.
 */
export function presentEvent(action: string): EventPresentation {
  const canonical = LEGACY_ALIASES[action] ?? action;
  const known = KNOWN[canonical];
  if (known) return known;

  // `mail.archive`, `mail.restore` and similar: real events, but mailbox
  // actions rather than security ones. Rendered plainly.
  if (canonical.startsWith("mail.")) {
    return {
      label: `Mailbox action: ${canonical.slice(5).replace(/[._]/g, " ")}`,
      description: "",
      icon: icons.mailbox.inbox,
      tone: "neutral",
    };
  }

  return {
    label: canonical.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    description: "",
    icon: icons.status.info,
    tone: "neutral",
  };
}

/** Where an event belongs in the "Sign-ins / Profile / Security" filter. */
export type EventCategory = "all" | "signin" | "profile" | "security" | "mail";

export function categorise(action: string): Exclude<EventCategory, "all"> {
  const canonical = LEGACY_ALIASES[action] ?? action;
  if (canonical.startsWith("auth.")) return "signin";
  if (canonical.startsWith("mail.")) return "mail";
  if (canonical.startsWith("profile.") || canonical.startsWith("preferences.")) return "profile";
  return "security";
}

/**
 * Group events by day, newest first.
 *
 * Buckets are relative to the reader's own clock, so `now` is injectable —
 * a function that reads the wall clock is a function that behaves differently
 * in a test at 23:59.
 */
export function groupByDay(
  entries: readonly AuditEntry[],
  now: Date = new Date()
): { label: string; entries: AuditEntry[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;

  const buckets = new Map<string, AuditEntry[]>();
  const order: string[] = [];

  for (const entry of entries) {
    const at = new Date(entry.createdAt).getTime();
    let label: string;
    if (Number.isNaN(at)) label = "Unknown date";
    else if (at >= startOfToday) label = "Today";
    else if (at >= startOfToday - day) label = "Yesterday";
    else if (at >= startOfToday - 7 * day) label = "Earlier this week";
    else label = "Earlier";

    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(entry);
  }

  return order.map((label) => ({ label, entries: buckets.get(label)! }));
}

/** Time of day, for a timeline row. */
export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The device string for an event, or null when none was recorded.
 *
 * Returns null rather than a placeholder so the caller decides how to say
 * "Not available" — and so it can never be mistaken for a real device.
 */
export function describeEventDevice(entry: AuditEntry): string | null {
  if (!entry.browser && !entry.os) return null;
  if (entry.browser && entry.os) return `${entry.browser} · ${entry.os}`;
  return entry.browser ?? entry.os;
}
