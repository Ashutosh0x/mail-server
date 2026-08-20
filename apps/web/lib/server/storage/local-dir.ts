import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, opendir, rename, rm, stat, copyFile, statfs, access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type {
  ConnectionProbe,
  ConnectorCapabilities,
  StorageConnector,
  StorageEntry,
  StorageUsageReport,
} from "./connector";
import { safeRelativePath } from "./connector";

/**
 * A connector over a directory the host already has mounted.
 *
 * This is what makes "use this detected disk" real. The operating system does
 * the mounting — an SMB share, a USB stick, an NFS export are all just
 * directories by the time they reach here — and this connector confines the
 * application to one subtree of it.
 *
 * The confinement is the entire security story, so it is done twice:
 *
 *   - The requested path is normalised and refused if it contains `..`, before
 *     it touches the filesystem at all.
 *   - The RESOLVED path is then checked against the root, which catches a
 *     symlink pointing outside. Normalising alone would not: /root/link is
 *     inside the root as a string, and /etc/shadow after resolution.
 *
 * A symlink escape is checked on the real path of the parent for writes,
 * because the target of a write does not exist yet and cannot be resolved.
 */
export class LocalDirectoryConnector implements StorageConnector {
  readonly kind = "local";
  private readonly root: string;

  constructor(root: string, private readonly readOnly = false) {
    this.root = resolve(root);
  }

  capabilities(): ConnectorCapabilities {
    return {
      read: true,
      write: !this.readOnly,
      move: !this.readOnly,
      copy: !this.readOnly,
      mkdir: !this.readOnly,
      usage: true,
    };
  }

  /**
   * Resolve a relative path inside the root, refusing anything that escapes.
   *
   * `mustExist` decides which of the two symlink checks applies: an existing
   * target is resolved directly, while a target being created is checked
   * through its parent, which does exist.
   */
  private async safe(path: string, mustExist: boolean): Promise<string> {
    const relative = safeRelativePath(path);
    if (relative === null) {
      throw new Error("That path is not allowed.");
    }

    const candidate = relative === "" ? this.root : join(this.root, relative);

    // String-level check first, so an obviously wrong path never reaches the
    // filesystem.
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) {
      throw new Error("That path is outside the storage root.");
    }

    try {
      const real = await realpath(mustExist ? candidate : dirname(candidate));
      const bound = mustExist ? real : real;
      if (bound !== this.root && !bound.startsWith(this.root + sep)) {
        // A symlink inside the root pointing out of it.
        throw new Error("That path resolves outside the storage root.");
      }
    } catch (cause) {
      // A path that does not exist yet is fine for a write; anything else is
      // rethrown so a real error is not swallowed as "not found".
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
      if (mustExist) throw new Error("That path does not exist.");
    }

    return candidate;
  }

  private assertWritable(): void {
    if (this.readOnly) throw new Error("This storage is read-only.");
  }

  async testConnection(options: { probeWrite?: boolean } = {}): Promise<ConnectionProbe> {
    const started = Date.now();
    try {
      await access(this.root, constants.R_OK);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException)?.code;
      return {
        state: code === "EACCES" || code === "EPERM" ? "permission_denied" : "unreachable",
        detail:
          code === "EACCES" || code === "EPERM"
            ? "The server does not have permission to read that path."
            : "That path is not reachable from the server.",
        usage: { totalBytes: null, usedBytes: null, freeBytes: null },
        latencyMs: null,
        writable: null,
      };
    }

    const latencyMs = Date.now() - started;
    const usage = await this.getUsage();

    let writable: boolean | null = this.readOnly ? false : null;
    if (options.probeWrite && !this.readOnly) {
      // Writability is only knowable by writing. A read-only mount and a
      // permissions problem both look identical until something is attempted.
      const probe = join(this.root, `.mailserver-write-probe-${Date.now()}`);
      try {
        await pipeline(
          (async function* () {
            yield Buffer.from("probe");
          })() as unknown as Readable,
          createWriteStream(probe)
        );
        writable = true;
      } catch {
        writable = false;
      } finally {
        await rm(probe, { force: true }).catch(() => undefined);
      }
    }

    return {
      state: this.readOnly || writable === false ? "read_only" : "connected",
      detail: this.readOnly || writable === false ? "Connected, read-only." : "Connected.",
      usage,
      latencyMs,
      writable,
    };
  }

  async list(path: string): Promise<StorageEntry[]> {
    const full = await this.safe(path, true);
    const entries: StorageEntry[] = [];

    // `opendir` streams the directory rather than materialising every name,
    // which matters on a share with tens of thousands of files.
    const dir = await opendir(full);
    for await (const item of dir) {
      const relative = [safeRelativePath(path), item.name].filter(Boolean).join("/");
      let size: number | null = null;
      let modifiedAt: string | null = null;

      try {
        const info = await stat(join(full, item.name));
        size = info.isDirectory() ? null : info.size;
        modifiedAt = info.mtime.toISOString();
      } catch {
        // A broken symlink or a file removed mid-listing. Reported with
        // unknown size rather than dropped, so it can still be deleted.
      }

      entries.push({
        name: item.name,
        path: relative,
        isDirectory: item.isDirectory(),
        size,
        modifiedAt,
        contentType: null,
      });
    }
    return entries;
  }

  async stat(path: string): Promise<StorageEntry | null> {
    try {
      const full = await this.safe(path, true);
      const info = await stat(full);
      const relative = safeRelativePath(path) ?? "";
      return {
        name: relative.split("/").pop() ?? "",
        path: relative,
        isDirectory: info.isDirectory(),
        size: info.isDirectory() ? null : info.size,
        modifiedAt: info.mtime.toISOString(),
        contentType: null,
      };
    } catch {
      return null;
    }
  }

  async mkdir(path: string): Promise<void> {
    this.assertWritable();
    await mkdir(await this.safe(path, false), { recursive: true });
  }

  async upload(path: string, body: Readable): Promise<void> {
    this.assertWritable();
    const full = await this.safe(path, false);
    await mkdir(dirname(full), { recursive: true });
    // Streamed with backpressure; the file never exists in memory.
    await pipeline(body, createWriteStream(full));
  }

  async download(path: string): Promise<Readable> {
    const full = await this.safe(path, true);
    const info = await stat(full);
    if (info.isDirectory()) throw new Error("That is a folder, not a file.");
    return createReadStream(full);
  }

  async delete(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    this.assertWritable();
    const relative = safeRelativePath(path);
    // Refusing "" specifically: deleting the root would wipe the share the
    // connection points at, which no file-browser action should ever mean.
    if (relative === null || relative === "") {
      throw new Error("That path cannot be deleted.");
    }
    await rm(await this.safe(path, true), { recursive: options.recursive ?? false, force: false });
  }

  async move(from: string, to: string): Promise<void> {
    this.assertWritable();
    const source = await this.safe(from, true);
    const destination = await this.safe(to, false);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  }

  async copy(from: string, to: string): Promise<void> {
    this.assertWritable();
    const source = await this.safe(from, true);
    const destination = await this.safe(to, false);
    const info = await stat(source);
    if (info.isDirectory()) throw new Error("Copying a folder is not supported yet.");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  async getUsage(): Promise<StorageUsageReport> {
    try {
      const stats = await statfs(this.root);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (!Number.isFinite(total) || total <= 0) {
        return { totalBytes: null, usedBytes: null, freeBytes: null };
      }
      return { totalBytes: total, freeBytes: free, usedBytes: total - free };
    } catch {
      // Unknown, not zero.
      return { totalBytes: null, usedBytes: null, freeBytes: null };
    }
  }
}
