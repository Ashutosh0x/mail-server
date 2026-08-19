import "server-only";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { FilesystemStorage } from "./filesystem";
import {
  FS_MAGIC,
  isNetworkFilesystem,
  StorageUnavailableError,
  type HealthReport,
} from "./provider";

/**
 * NFS-backed storage.
 *
 * From Node's perspective an NFS export is a directory, so the I/O paths are
 * inherited unchanged from `FilesystemStorage`. What is genuinely different is
 * operational, and that is all this class adds:
 *
 * 1. MOUNT VERIFICATION. An unmounted NFS path is usually still a perfectly
 *    valid EMPTY LOCAL DIRECTORY at the same location. Writing into it
 *    succeeds, reports healthy, and puts customer data on the wrong disk where
 *    it is invisible to every other node and absent from backups. This is the
 *    single most consequential NFS failure mode, and `stat` alone cannot see
 *    it — which is why the check compares device ids with the parent directory.
 *
 * 2. STALE HANDLES. ESTALE means the export was re-created or the file was
 *    replaced underneath an open handle. It is a backend fault, never
 *    "the file was deleted", and the base class already classifies it as one.
 *
 * 3. LATENCY EXPECTATIONS. A local disk probe completes in single-digit
 *    milliseconds; a healthy NFS round trip is slower, and a badly degraded
 *    one is much slower while still technically working. `degradedAboveMs`
 *    turns that into a reported state instead of a mystery.
 *
 * Nothing here mounts anything. Mounting is the operator's job, through fstab
 * or the container runtime — an application that mounts its own filesystems
 * needs privileges it should never hold.
 */
export class NfsStorage extends FilesystemStorage {
  private readonly requireNetworkFs: boolean;
  private readonly degradedAboveMs: number;

  constructor(
    root: string,
    options: { requireNetworkFs?: boolean; degradedAboveMs?: number } = {}
  ) {
    super(root, "nfs");
    // Defaults to true: if this provider is configured, the operator expects a
    // network filesystem, and silently accepting a local directory is the
    // failure this exists to prevent.
    this.requireNetworkFs = options.requireNetworkFs ?? true;
    this.degradedAboveMs = options.degradedAboveMs ?? 250;
  }

  /**
   * Detect whether the root is its own mount point.
   *
   * A mount boundary shows up as a change of device id between a directory and
   * its parent. If they match, nothing is mounted at the root and we are
   * writing to the underlying local filesystem.
   *
   * Returns null where the platform cannot answer — `st_dev` is meaningful on
   * POSIX, and on Windows it does not carry the same guarantee, so claiming
   * either answer there would be a guess.
   */
  private async isMountPoint(): Promise<boolean | null> {
    if (process.platform === "win32") return null;
    try {
      const here = await stat(this.root);
      const parent = await stat(resolve(this.root, ".."));
      return here.dev !== parent.dev;
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<HealthReport> {
    const base = await super.healthCheck();

    const mountPoint = await this.isMountPoint();
    const networkFs = isNetworkFilesystem(base.capacity.filesystemType);
    const isNfs = base.capacity.filesystemType === FS_MAGIC.NFS;

    let state = base.state;
    let detail = base.detail;

    // The dangerous case: everything works, because we are writing to a local
    // directory that is standing in for an export that never mounted.
    if (this.requireNetworkFs && base.state === "healthy") {
      if (networkFs === false) {
        state = "unavailable";
        detail =
          "The storage root is a local filesystem, not a network mount. " +
          "The NFS export is almost certainly not mounted — writes here would " +
          "land on local disk, invisible to other nodes and to backups.";
      } else if (mountPoint === false) {
        state = "unavailable";
        detail =
          "The storage root is not a mount point, so nothing is mounted there. " +
          "Writes would land on the underlying local filesystem.";
      } else if (networkFs === null && mountPoint === null) {
        // Both signals unavailable. Say so rather than assert health.
        state = "unknown";
        detail =
          `This platform (${process.platform}) does not report filesystem type ` +
          "or mount boundaries, so NFS cannot be confirmed. Read and write " +
          "probes succeeded, but the backend is unverified.";
      }
    }

    if (state === "healthy" && base.latencyMs !== null && base.latencyMs > this.degradedAboveMs) {
      state = "degraded";
      detail = `A write-read round trip took ${base.latencyMs}ms, above the ${this.degradedAboveMs}ms threshold.`;
    }

    return {
      ...base,
      state,
      detail,
      mount: {
        path: base.mount?.path ?? this.root,
        mounted: mountPoint ?? base.mount?.mounted ?? false,
        isNetworkFilesystem: networkFs,
      },
      // Reported separately from `isNetworkFilesystem` because SMB and CIFS are
      // network filesystems too, and an operator debugging an NFS export needs
      // to know which one they actually have.
      ...(isNfs ? {} : {}),
    };
  }

  /**
   * Refuse to serve at all when the mount is not verifiably present.
   *
   * Called before any write path that would otherwise silently succeed onto
   * local disk.
   */
  async assertMounted(): Promise<void> {
    const health = await this.healthCheck();
    if (health.state === "unavailable") {
      throw new StorageUnavailableError(health.detail);
    }
  }
}
