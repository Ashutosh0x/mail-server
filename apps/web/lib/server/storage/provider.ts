import "server-only";
import type { Readable } from "node:stream";

/**
 * The storage provider contract.
 *
 * One seam between the application and wherever bytes actually live, so that
 * mail attachments and Drive files never learn whether they are sitting on a
 * local disk, an NFS export or an object store.
 *
 * The distinction that matters throughout: the DATABASE owns metadata, the
 * PROVIDER owns bytes. A provider never reads the database and never applies
 * an authorization rule — by the time a call reaches here, the caller has
 * already established that this user may touch this object. Putting a
 * permission check in a storage driver is how two drivers end up enforcing
 * subtly different rules.
 */

export interface StoredObject {
  key: string;
  size: number;
  /** SHA-256, computed while streaming — never by re-reading the object. */
  checksum: string;
}

export interface ObjectStat {
  key: string;
  size: number;
  modifiedAt: Date;
}

/**
 * A provider's health, as measured rather than assumed.
 *
 * `unknown` exists and is the default for a reason: a health field that has
 * never been probed must not report `healthy`. Every green tick in the admin
 * UI has to trace back to a check that actually ran.
 */
export type HealthState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface CapacityReport {
  /** Bytes, from the filesystem itself. Null when it cannot be determined. */
  totalBytes: number | null;
  availableBytes: number | null;
  usedBytes: number | null;
  /** Inode exhaustion takes a volume down with terabytes still free. */
  totalInodes: number | null;
  availableInodes: number | null;
  /**
   * Filesystem magic number from `statfs`, when the platform reports one.
   * Linux gives 0x6969 for NFS; Windows always reports 0, so the value is
   * exposed raw and interpreted separately rather than guessed at here.
   */
  filesystemType: number | null;
}

export interface HealthReport {
  provider: string;
  state: HealthState;
  /** Human-readable reason, always present when the state is not healthy. */
  detail: string;
  checkedAt: string;
  /** Round-trip of a real write-read-delete probe, in milliseconds. */
  latencyMs: number | null;
  readable: boolean;
  writable: boolean;
  capacity: CapacityReport;
  /** Populated by providers that sit on a mount, e.g. NFS. */
  mount?: {
    path: string;
    mounted: boolean;
    /** True only where the platform actually confirms it. */
    isNetworkFilesystem: boolean | null;
  };
}

export interface StorageProvider {
  /** Stable identifier, surfaced in health output and logs. */
  readonly name: string;

  put(stream: Readable, key: string): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  /** Byte range, for resumable downloads. `end` is inclusive, as in HTTP. */
  getRange(key: string, start: number, end?: number): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<ObjectStat | null>;
  /** Server-side move. Falls back to copy-then-delete where unsupported. */
  move(fromKey: string, toKey: string): Promise<void>;
  copy(fromKey: string, toKey: string): Promise<void>;

  /**
   * Actually probe the backend. Implementations must perform real I/O — a
   * health check that returns a constant is worse than none, because it
   * converts an outage into a silent one.
   */
  healthCheck(): Promise<HealthReport>;
}

/**
 * Raised when the backend is unreachable, as distinct from an object being
 * absent.
 *
 * The distinction is the whole point: "your file is gone" and "we cannot
 * reach the disk right now" require opposite reactions from a user, and
 * collapsing them into one error is how a network blip gets reported as data
 * loss.
 */
export class StorageUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

/**
 * POSIX error codes that mean "the backend is having a problem", not "the
 * object does not exist".
 *
 * ESTALE is the NFS-specific one worth knowing: the server was re-exported or
 * the file was replaced underneath us, and the handle the client holds no
 * longer resolves. Treating it as ENOENT would report a healthy file as
 * deleted.
 */
export const BACKEND_ERROR_CODES = new Set([
  "ESTALE",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EIO",
  "EREMOTEIO",
  "ENODEV",
  "EBUSY",
  "EAGAIN",
]);

export function isBackendError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && BACKEND_ERROR_CODES.has(code);
}

/** Linux `statfs` magic numbers. Absent on Windows, which reports 0. */
export const FS_MAGIC = {
  NFS: 0x6969,
  SMB: 0x517b,
  SMB2: 0xfe534d42,
  CIFS: 0xff534d42,
  FUSE: 0x65735546,
  TMPFS: 0x01021994,
  EXT4: 0xef53,
  XFS: 0x58465342,
  BTRFS: 0x9123683e,
  ZFS: 0x2fc12fc1,
} as const;

const NETWORK_MAGICS = new Set<number>([
  FS_MAGIC.NFS,
  FS_MAGIC.SMB,
  FS_MAGIC.SMB2,
  FS_MAGIC.CIFS,
]);

/**
 * Whether a filesystem magic number identifies a network filesystem.
 *
 * Returns null rather than false when the platform gave us nothing to work
 * with — Windows reports type 0 for everything, and answering "no, it is not
 * a network filesystem" from an absence of data would be a guess presented as
 * a fact.
 */
export function isNetworkFilesystem(type: number | null): boolean | null {
  if (type === null || type === 0) return null;
  return NETWORK_MAGICS.has(type);
}
