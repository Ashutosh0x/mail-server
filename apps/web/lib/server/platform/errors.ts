import "server-only";

/**
 * Operating-system errors, translated into things a person can act on.
 *
 * `EACCES` is not a message. It tells a developer what happened and tells
 * everyone else nothing, and worse, the raw error often carries the full
 * server path — which is both unhelpful and a small information leak.
 *
 * So the code is mapped to a product-level category with a message written for
 * the person reading it, and the original is kept for the server log where it
 * belongs. Windows and POSIX report different codes for the same situation, so
 * both are mapped to one category rather than the UI learning both.
 */

export type StorageErrorKind =
  | "not_found"
  | "permission_denied"
  | "read_only"
  | "busy"
  | "unavailable"
  | "connection_refused"
  | "authentication_failed"
  | "out_of_space"
  | "name_too_long"
  | "not_empty"
  | "already_exists"
  | "timeout"
  | "unknown";

export interface NormalisedError {
  kind: StorageErrorKind;
  /** Written for the person who hit it. Contains no path and no code. */
  message: string;
  /** The original code, for the server log. Never sent to a client. */
  code: string | null;
}

/**
 * POSIX and Windows codes that mean the same thing to a user.
 *
 * Node surfaces Win32 errors through the same `code` field, so both families
 * land here. `EPERM` appears under permission rather than its literal meaning
 * because on Windows it is what a locked or read-only file usually reports.
 */
const BY_CODE: Record<string, { kind: StorageErrorKind; message: string }> = {
  ENOENT: { kind: "not_found", message: "That file or folder no longer exists." },
  ENOTDIR: { kind: "not_found", message: "That path is not a folder." },
  EISDIR: { kind: "not_found", message: "That path is a folder, not a file." },

  EACCES: { kind: "permission_denied", message: "The server does not have permission to use that location." },
  EPERM: { kind: "permission_denied", message: "The server does not have permission to use that location." },

  EROFS: { kind: "read_only", message: "That storage is read-only." },

  EBUSY: { kind: "busy", message: "That storage is in use. Try again in a moment." },
  ETXTBSY: { kind: "busy", message: "That file is in use. Try again in a moment." },

  ENODEV: { kind: "unavailable", message: "That storage device is not available." },
  ENXIO: { kind: "unavailable", message: "That storage device is not available." },
  EHOSTUNREACH: { kind: "unavailable", message: "That storage server cannot be reached." },
  ENETUNREACH: { kind: "unavailable", message: "That storage server cannot be reached." },
  // Stale NFS handle: the export was remounted underneath us.
  ESTALE: { kind: "unavailable", message: "The connection to that storage was lost. Reconnect and try again." },

  ECONNREFUSED: { kind: "connection_refused", message: "That storage server refused the connection." },
  ECONNRESET: { kind: "connection_refused", message: "That storage server closed the connection." },

  ENOSPC: { kind: "out_of_space", message: "That storage is full." },
  EDQUOT: { kind: "out_of_space", message: "The storage quota has been reached." },

  ENAMETOOLONG: { kind: "name_too_long", message: "That name is too long for this storage." },
  ENOTEMPTY: { kind: "not_empty", message: "That folder is not empty." },
  EEXIST: { kind: "already_exists", message: "Something with that name already exists." },

  ETIMEDOUT: { kind: "timeout", message: "That storage did not respond in time." },
  ERR_SOCKET_CONNECTION_TIMEOUT: { kind: "timeout", message: "That storage did not respond in time." },
};

/**
 * Windows error text, for the cases where Node hands back a message rather
 * than a mapped `code`.
 */
const BY_TEXT: [RegExp, { kind: StorageErrorKind; message: string }][] = [
  [/access is denied/i, { kind: "permission_denied", message: "The server does not have permission to use that location." }],
  [/being used by another process/i, { kind: "busy", message: "That file is in use. Try again in a moment." }],
  [/not enough space/i, { kind: "out_of_space", message: "That storage is full." }],
  [/network path was not found/i, { kind: "unavailable", message: "That network location could not be found." }],
  [/network name cannot be found/i, { kind: "unavailable", message: "That network location could not be found." }],
  [/logon failure|bad username or password/i, { kind: "authentication_failed", message: "Those credentials were rejected." }],
];

export function normaliseError(cause: unknown): NormalisedError {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code ?? null;

  if (code && BY_CODE[code]) {
    return { ...BY_CODE[code]!, code };
  }

  const text = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  for (const [pattern, mapped] of BY_TEXT) {
    if (pattern.test(text)) return { ...mapped, code };
  }

  // Messages this codebase writes itself are already user-facing, and are
  // passed through rather than replaced with something vaguer.
  if (
    /read-only|not allowed|outside the storage root|cannot be deleted|is larger than|no stored credentials/i.test(
      text
    )
  ) {
    return { kind: "unknown", message: text, code };
  }

  return {
    kind: "unknown",
    // Deliberately says nothing about paths or internals.
    message: "That storage operation could not be completed.",
    code,
  };
}

/** HTTP status for a normalised category, so routes answer consistently. */
export function statusFor(kind: StorageErrorKind): number {
  switch (kind) {
    case "not_found":
      return 404;
    case "permission_denied":
    case "read_only":
    case "authentication_failed":
      return 403;
    case "already_exists":
    case "not_empty":
    case "name_too_long":
      return 409;
    case "out_of_space":
      return 507;
    case "busy":
    case "unavailable":
    case "connection_refused":
    case "timeout":
      return 502;
    default:
      return 500;
  }
}
