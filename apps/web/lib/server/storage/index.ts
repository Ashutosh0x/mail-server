import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { FilesystemStorage } from "./filesystem";
import { NfsStorage } from "./nfs";
import type { StorageProvider } from "./provider";

export * from "./provider";
export { FilesystemStorage } from "./filesystem";
export { NfsStorage } from "./nfs";

/**
 * A storage key is generated, never derived from user input.
 *
 * Deriving it from a filename is how `../../etc/passwd` becomes a write path.
 * The original name lives in the database as data; the key is a UUID.
 */
export function newStorageKey(userId: string): string {
  const id = randomUUID();
  // Two levels of fan-out: a single directory holding a million files is slow
  // to list and slow to open on most filesystems, NFS especially.
  return `${userId}/${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`;
}

let provider: StorageProvider | undefined;

/**
 * The configured provider.
 *
 * An unimplemented driver throws at first use rather than falling back to
 * local disk. A silent fallback is how attachments end up on one node and 404
 * from every other one — the failure surfaces days later, as missing files.
 */
export function storage(): StorageProvider {
  if (provider) return provider;

  switch (config.storageDriver) {
    case "filesystem":
      provider = new FilesystemStorage(config.storageRoot);
      return provider;

    case "nfs":
      provider = new NfsStorage(config.storageRoot, {
        requireNetworkFs: config.nfsRequireNetworkFs,
        degradedAboveMs: config.nfsDegradedAboveMs,
      });
      return provider;

    default:
      throw new Error(
        `OBJECT_STORAGE_DRIVER="${config.storageDriver}" is not implemented. ` +
          `Implemented drivers: "filesystem", "nfs". ` +
          `S3-compatible object storage is planned but has no provider yet — see docs/STORAGE-ARCHITECTURE.md.`
      );
  }
}

/** Test seam. Resets the memoised provider so config changes take effect. */
export function resetStorageProvider(): void {
  provider = undefined;
}
