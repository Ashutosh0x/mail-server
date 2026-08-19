/**
 * Minimal request validation.
 *
 * Deliberately NOT marked `server-only`: it is pure, it holds no secrets and
 * no database access, and the same rules are worth reusing in a client-side
 * form so a user sees the error before a round trip.

 *
 * Hand-written rather than a schema library: the surface is small, and every
 * rule here is one a mail server genuinely needs. Each function returns a
 * message on failure rather than throwing, so a route can report which field
 * was wrong instead of a generic 400.
 */

/**
 * RFC 5321 addr-spec, pragmatically.
 *
 * Deliberately NOT the full grammar — quoted local parts and comments are legal
 * and essentially never used, and every regex that tries to cover them has a
 * catastrophic-backtracking case. This rejects the shapes an MTA would reject
 * anyway, with a bounded scan.
 */
export function isEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > 254) return false;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;

  if (domain.length > 253 || domain.startsWith("-") || domain.endsWith("-")) return false;
  if (!domain.includes(".")) return false;
  return domain.split(".").every((label) => /^[A-Za-z0-9-]{1,63}$/.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}

/**
 * Reject any header value carrying CR or LF.
 *
 * This is the SMTP header-injection guard: a subject containing "\r\nBcc:" is
 * how one message becomes a relay for a thousand.
 */
export function isHeaderSafe(value: string): boolean {
  return !/[\r\n\u2028\u2029]/.test(value);
}

export function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string") return "Password is required.";
  if (value.length < 12) return "Use at least 12 characters.";
  if (value.length > 1024) return "That password is too long.";
  return null;
}
