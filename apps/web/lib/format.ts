import type { EmailAddress } from "@mailserver/types";

/** The name a human recognises, falling back to the address' local part. */
export function senderLabel(from: EmailAddress[]): string {
  const first = from[0];
  if (!first) return "(unknown sender)";
  if (first.name && first.name.trim()) return first.name;
  return first.email.split("@")[0] ?? first.email;
}

/** Up to two initials for the avatar tile. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * Mail-list timestamp: time for today, weekday inside a week, date beyond.
 *
 * `now` is injectable so the tests do not depend on when they run — a format
 * function that reads the wall clock is a function that fails at midnight.
 */
export function formatListTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) {
    return then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days >= 0 && days < 7) return then.toLocaleDateString("en-US", { weekday: "short" });

  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Human byte size. Attachment sizes are shown next to a filename, so this
 *  stays short: "4.2 MB", never "4,194,304 bytes". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}
