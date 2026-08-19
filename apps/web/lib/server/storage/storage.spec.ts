import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { FilesystemStorage } from "./filesystem";
import { NfsStorage } from "./nfs";
import {
  isNetworkFilesystem,
  isBackendError,
  FS_MAGIC,
  ObjectNotFoundError,
  StorageUnavailableError,
} from "./provider";

/**
 * These run against a REAL temporary directory, not a mocked filesystem.
 *
 * The behaviours that matter here — atomic rename, path-escape refusal, the
 * difference between a missing object and an unreachable backend — are
 * properties of actual filesystem calls. A mocked `fs` would assert that the
 * mock behaves as written, which proves nothing.
 */

let root: string;
let store: FilesystemStorage;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mailserver-storage-"));
  store = new FilesystemStorage(root, "test");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("put / get", () => {
  it("round-trips content and reports the real size and checksum", async () => {
    const payload = Buffer.from("the quick brown fox");
    const result = await store.put(Readable.from(payload), "a/b/object");

    expect(result.size).toBe(payload.length);
    expect(result.checksum).toBe(createHash("sha256").update(payload).digest("hex"));
    expect(await collect(await store.get("a/b/object"))).toEqual(payload);
  });

  it("computes the checksum from the bytes actually written", async () => {
    // Guards against a future refactor that hashes the input separately from
    // what reaches the disk.
    const payload = Buffer.alloc(256 * 1024, 0xab);
    const { checksum } = await store.put(Readable.from(payload), "big");
    const readBack = await collect(await store.get("big"));
    expect(createHash("sha256").update(readBack).digest("hex")).toBe(checksum);
  });

  it("leaves no partial file under the real key when the source fails", async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("source exploded"));
      },
    });

    await expect(store.put(failing, "doomed")).rejects.toThrow();
    // The object must not exist: a reader must never see a truncated file
    // that looks complete.
    expect(await store.exists("doomed")).toBe(false);
  });

  it("cleans up its temporary file after a failed write", async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error("nope"));
      },
    });
    await expect(store.put(failing, "doomed")).rejects.toThrow();
    const entries = await readdir(root);
    expect(entries.filter((name) => name.includes(".part"))).toEqual([]);
  });
});

describe("path safety", () => {
  it("refuses a key that escapes the storage root", async () => {
    for (const key of ["../escape", "a/../../escape", "../../etc/passwd"]) {
      await expect(store.put(Readable.from("x"), key), key).rejects.toThrow(/outside the storage root/);
    }
  });

  it("refuses to read through an escaping key", async () => {
    await expect(store.get("../../etc/passwd")).rejects.toThrow(/outside the storage root/);
  });
});

describe("missing objects versus an unreachable backend", () => {
  it("throws ObjectNotFoundError for an absent object", async () => {
    await expect(store.get("nope")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("reports exists() as false for an absent object", async () => {
    expect(await store.exists("nope")).toBe(false);
    expect(await store.stat("nope")).toBeNull();
  });

  it("classifies NFS and network error codes as backend faults", () => {
    // ESTALE is the NFS-specific one: the export was re-created underneath an
    // open handle. Treating it as ENOENT would report a live file as deleted.
    for (const code of ["ESTALE", "ETIMEDOUT", "EHOSTDOWN", "EIO", "ECONNRESET"]) {
      expect(isBackendError(Object.assign(new Error(code), { code })), code).toBe(true);
    }
  });

  it("does not classify a missing file as a backend fault", () => {
    expect(isBackendError(Object.assign(new Error("gone"), { code: "ENOENT" }))).toBe(false);
  });

  it("deleting an absent object succeeds, because that is the desired state", async () => {
    await expect(store.delete("never-existed")).resolves.toBeUndefined();
  });
});

describe("ranges", () => {
  it("returns the requested inclusive byte range", async () => {
    await store.put(Readable.from(Buffer.from("0123456789")), "digits");
    // HTTP Range is inclusive at both ends, and so is this.
    expect((await collect(await store.getRange("digits", 2, 5))).toString()).toBe("2345");
  });

  it("returns the remainder when no end is given", async () => {
    await store.put(Readable.from(Buffer.from("0123456789")), "digits");
    expect((await collect(await store.getRange("digits", 7))).toString()).toBe("789");
  });
});

describe("move and copy", () => {
  it("moves an object, leaving nothing behind", async () => {
    await store.put(Readable.from(Buffer.from("payload")), "from/key");
    await store.move("from/key", "to/key");
    expect(await store.exists("from/key")).toBe(false);
    expect((await collect(await store.get("to/key"))).toString()).toBe("payload");
  });

  it("copies an object, leaving the original", async () => {
    await store.put(Readable.from(Buffer.from("payload")), "from/key");
    await store.copy("from/key", "to/key");
    expect(await store.exists("from/key")).toBe(true);
    expect((await collect(await store.get("to/key"))).toString()).toBe("payload");
  });
});

describe("health check", () => {
  it("performs real I/O and reports healthy on a working directory", async () => {
    const report = await store.healthCheck();
    expect(report.state).toBe("healthy");
    expect(report.readable).toBe(true);
    expect(report.writable).toBe(true);
    // A latency of null would mean the probe never ran.
    expect(report.latencyMs).not.toBeNull();
    expect(report.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reads capacity from the filesystem rather than inventing it", async () => {
    const { capacity } = await store.healthCheck();
    expect(capacity.totalBytes).toBeGreaterThan(0);
    expect(capacity.availableBytes).toBeGreaterThanOrEqual(0);
    // Used must be consistent with the other two, not a separate guess.
    expect(capacity.usedBytes).toBe((capacity.totalBytes ?? 0) - (capacity.availableBytes ?? 0));
  });

  it("leaves no probe artefacts behind", async () => {
    await store.healthCheck();
    await store.healthCheck();
    const probes = await readdir(join(root, ".health")).catch(() => []);
    expect(probes).toEqual([]);
  });

  it("reports unavailable when the root cannot be used at all", async () => {
    const missing = new FilesystemStorage(join(root, "does", "not", "exist", "\0bad"), "broken");
    const report = await missing.healthCheck();
    expect(report.state).toBe("unavailable");
    expect(report.writable).toBe(false);
    expect(report.detail).not.toBe("");
  });
});

describe("filesystem type detection", () => {
  it("identifies NFS from its magic number", () => {
    expect(isNetworkFilesystem(FS_MAGIC.NFS)).toBe(true);
  });

  it("identifies SMB and CIFS as network filesystems too", () => {
    expect(isNetworkFilesystem(FS_MAGIC.SMB)).toBe(true);
    expect(isNetworkFilesystem(FS_MAGIC.CIFS)).toBe(true);
  });

  it("identifies local filesystems as not networked", () => {
    expect(isNetworkFilesystem(FS_MAGIC.EXT4)).toBe(false);
    expect(isNetworkFilesystem(FS_MAGIC.XFS)).toBe(false);
  });

  it("returns null, not false, when the platform reports nothing", () => {
    // Windows reports type 0 for every filesystem. Answering "not a network
    // filesystem" from an absence of data would be a guess stated as a fact.
    expect(isNetworkFilesystem(0)).toBeNull();
    expect(isNetworkFilesystem(null)).toBeNull();
  });
});

describe("NfsStorage", () => {
  it("refuses to report healthy when the root is plainly local", async () => {
    // The failure this exists to catch: the export never mounted, so the path
    // is an ordinary empty local directory. Writes succeed onto the wrong
    // disk, invisible to other nodes and to backups.
    const nfs = new NfsStorage(root, { requireNetworkFs: true });
    const report = await nfs.healthCheck();
    expect(report.state).not.toBe("healthy");
    expect(report.detail.length).toBeGreaterThan(0);
  });

  it("can be pointed at local storage deliberately", async () => {
    const nfs = new NfsStorage(root, { requireNetworkFs: false });
    const report = await nfs.healthCheck();
    expect(report.readable).toBe(true);
    expect(report.writable).toBe(true);
  });

  it("assertMounted throws when the mount cannot be verified", async () => {
    const nfs = new NfsStorage(root, { requireNetworkFs: true });
    const report = await nfs.healthCheck();
    if (report.state === "unavailable") {
      await expect(nfs.assertMounted()).rejects.toBeInstanceOf(StorageUnavailableError);
    } else {
      // On a platform that cannot report mount boundaries the state is
      // `unknown`, which is not an assertion of health and must not throw.
      expect(report.state).toBe("unknown");
      await expect(nfs.assertMounted()).resolves.toBeUndefined();
    }
  });

  it("still performs all the base I/O correctly", async () => {
    const nfs = new NfsStorage(root, { requireNetworkFs: false });
    const payload = Buffer.from("over the wire");
    await nfs.put(Readable.from(payload), "remote/object");
    expect(await collect(await nfs.get("remote/object"))).toEqual(payload);
    await nfs.delete("remote/object");
    expect(await nfs.exists("remote/object")).toBe(false);
  });
});
