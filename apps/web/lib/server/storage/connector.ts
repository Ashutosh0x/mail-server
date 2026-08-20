import "server-only";
import type { Readable } from "node:stream";

/**
 * The storage connector contract.
 *
 * One interface for every backend, so the UI and the API routes contain no
 * provider-specific logic: a file browser talks to `list` and `upload`, and
 * whether that lands on a local disk or a WebDAV server is decided here.
 *
 * Two rules that shape the whole design:
 *
 * 1. EVERY PATH IS RELATIVE TO THE CONNECTION'S ROOT. Connectors never accept
 *    an absolute filesystem path from a caller. The root lives in the
 *    connection record and is applied inside the connector, so an API route
 *    cannot forget to apply it.
 *
 * 2. CAPABILITIES ARE DECLARED, NOT ASSUMED. A read-only mount says so, and
 *    the UI disables writes rather than offering a button that fails. Anything
 *    a backend genuinely cannot report comes back `null` — never zero, never
 *    an estimate.
 */

export interface StorageEntry {
  name: string;
  /** Path relative to the connection root, using forward slashes. */
  path: string;
  isDirectory: boolean;
  /** Null when the backend does not report a size for this entry. */
  size: number | null;
  modifiedAt: string | null;
  contentType: string | null;
}

export interface StorageUsageReport {
  totalBytes: number | null;
  usedBytes: number | null;
  freeBytes: number | null;
}

export interface ConnectorCapabilities {
  read: boolean;
  write: boolean;
  /** Server-side move, as opposed to copy-then-delete. */
  move: boolean;
  copy: boolean;
  mkdir: boolean;
  /** Whether `getUsage()` can return real numbers for this backend. */
  usage: boolean;
}

/**
 * States a connection can actually be in.
 *
 * Every one is derived from a real operation. There is no "connected" that
 * means "we wrote a row and assumed".
 */
export type ConnectionState =
  | "connected"
  | "read_only"
  | "authentication_required"
  | "permission_denied"
  | "unreachable"
  | "error";

export interface ConnectionProbe {
  state: ConnectionState;
  detail: string;
  usage: StorageUsageReport;
  latencyMs: number | null;
  /** Verified by attempting a write, when the caller asks for it. */
  writable: boolean | null;
}

export interface StorageConnector {
  readonly kind: string;
  capabilities(): ConnectorCapabilities;

  /** A real probe. Must perform I/O; a constant here converts an outage into a silent one. */
  testConnection(options?: { probeWrite?: boolean }): Promise<ConnectionProbe>;

  list(path: string): Promise<StorageEntry[]>;
  stat(path: string): Promise<StorageEntry | null>;
  mkdir(path: string): Promise<void>;

  /** Streams in. Implementations must not buffer the whole body. */
  upload(path: string, body: Readable, size?: number): Promise<void>;
  /** Streams out, for the same reason. */
  download(path: string): Promise<Readable>;

  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;

  getUsage(): Promise<StorageUsageReport>;
}

/**
 * Normalise a caller-supplied path to a safe relative form.
 *
 * Refuses rather than clamps. Clamping turns "../../etc/passwd" into a write
 * somewhere unexpected but permitted, which is harder to notice than an error
 * and just as wrong — the caller asked for something it must not have.
 *
 * Also refuses NUL bytes, which some filesystem APIs treat as a terminator and
 * can be used to smuggle a different path past a suffix check.
 */
export function safeRelativePath(input: string): string | null {
  if (input.includes("\0")) return null;

  // Backslashes are separators on Windows, so they must be normalised before
  // the traversal check rather than surviving it as ordinary characters.
  const unified = input.replace(/\\/g, "/");

  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * Reject a filename that would be interpreted rather than stored.
 *
 * Separators are the important case: a "filename" containing one is a path,
 * and rename/create would place it somewhere the user did not choose.
 */
export function isSafeName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name === "." || name === "..") return false;
  if (/[/\\\0]/.test(name)) return false;
  // Trailing dots and spaces are silently stripped by Windows, so a file
  // created as "report.txt " would come back as something else.
  if (/[ .]$/.test(name)) return false;
  return true;
}
