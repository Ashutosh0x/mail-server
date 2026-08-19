import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { config } from "./config";

/**
 * Object storage, behind an adapter.
 *
 * Only the filesystem driver is implemented. S3/R2/GCS/Azure all speak the same
 * four operations below, so adding one is a new class rather than a change to
 * every caller — which is the point of the interface existing before there is a
 * second implementation.
 *
 * Nothing here ever loads a whole file into memory. A 100 MB attachment on a
 * server handling twenty concurrent uploads is 2 GB of heap if you do.
 */

export interface StoredObject {
  key: string;
  size: number;
  /** SHA-256, computed while streaming — not by re-reading the file. */
  checksum: string;
}

export interface StorageAdapter {
  put(stream: Readable, key: string): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * A storage key is generated, never derived from user input.
 *
 * Deriving it from a filename is how `../../etc/passwd` becomes a write path.
 * The original name lives in the database as data; the key is a UUID.
 */
export function newStorageKey(userId: string): string {
  const id = randomUUID();
  // Two levels of fan-out: a single directory with a million files is slow to
  // list and slow to open on most filesystems.
  return `${userId}/${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`;
}

class FilesystemStorage implements StorageAdapter {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(process.cwd(), root);
  }

  /**
   * Resolve a key to a path, refusing anything that escapes the root.
   *
   * The keys we generate are safe by construction, but this is the last line
   * before the filesystem and it costs one comparison — so it checks anyway
   * rather than trusting every future caller.
   */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error("Refusing to resolve a storage key outside the storage root");
    }
    return full;
  }

  async put(stream: Readable, key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    const hash = createHash("sha256");
    let size = 0;
    // Hash and measure in-flight, so the bytes are read exactly once.
    const measured = new Readable({
      read() {},
    });
    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      size += chunk.length;
      measured.push(chunk);
    });
    stream.on("end", () => measured.push(null));
    stream.on("error", (error) => measured.destroy(error));

    await pipeline(measured, createWriteStream(path));
    return { key, size, checksum: hash.digest("hex") };
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    if (!existsSync(path)) throw new Error(`Object not found: ${key}`);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      // Deleting something already gone is the desired end state.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

let adapter: StorageAdapter | undefined;

export function storage(): StorageAdapter {
  if (adapter) return adapter;
  if (config.storageDriver === "filesystem") {
    adapter = new FilesystemStorage(config.storageRoot);
    return adapter;
  }
  // Fail loudly. A misconfigured driver silently falling back to local disk is
  // how attachments end up on one node and 404 from every other one.
  throw new Error(
    `OBJECT_STORAGE_DRIVER="${config.storageDriver}" is not implemented. ` +
      `Only "filesystem" exists today; implement a StorageAdapter for S3/R2/GCS before setting this.`
  );
}

export { join as joinPath };
