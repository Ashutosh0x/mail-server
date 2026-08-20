import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { LocalDirectoryConnector } from "./local-dir";
import { safeRelativePath, isSafeName } from "./connector";

/**
 * The filesystem connector, against a real directory tree.
 *
 * The confinement is the whole security story here: this connector is handed a
 * root that may be a USB stick or a mounted SMB share, and everything outside
 * that root is the rest of the server's disk. These tests use real files and
 * real symlinks, because a mocked `fs` would happily agree with a broken
 * check.
 */

let root: string;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "localdir-"));
  root = join(base, "share");
  outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "readme.txt"), "inside the root\n");
  writeFileSync(join(root, "docs", "note.txt"), "nested\n");
  // The file an escape would be trying to reach.
  writeFileSync(join(outside, "secret.txt"), "must never be readable\n");
});

afterAll(() => {
  rmSync(join(root, ".."), { recursive: true, force: true });
});

const connector = (readOnly = false) => new LocalDirectoryConnector(root, readOnly);

describe("path normalisation", () => {
  it("refuses traversal rather than clamping it", () => {
    // Clamping would turn a traversal attempt into a write somewhere
    // unexpected but permitted, which is harder to notice and just as wrong.
    expect(safeRelativePath("../etc/passwd")).toBeNull();
    expect(safeRelativePath("docs/../../etc")).toBeNull();
  });

  it("refuses a NUL byte", () => {
    // Some filesystem APIs treat it as a terminator, which smuggles a
    // different path past a suffix check.
    expect(safeRelativePath("ok.txt\0.png")).toBeNull();
  });

  it("normalises separators and redundant segments", () => {
    expect(safeRelativePath("docs//./note.txt")).toBe("docs/note.txt");
    expect(safeRelativePath("docs\\note.txt")).toBe("docs/note.txt");
    expect(safeRelativePath("/leading/slash")).toBe("leading/slash");
  });

  it("rejects names that are paths or that Windows would rewrite", () => {
    expect(isSafeName("fine.txt")).toBe(true);
    expect(isSafeName("../escape")).toBe(false);
    expect(isSafeName("has/slash")).toBe(false);
    expect(isSafeName("")).toBe(false);
    expect(isSafeName("..")).toBe(false);
    // Windows silently strips these, so the file would come back renamed.
    expect(isSafeName("trailing ")).toBe(false);
    expect(isSafeName("trailing.")).toBe(false);
  });
});

describe("confinement", () => {
  it("lists inside the root", async () => {
    const names = (await connector().list("")).map((e) => e.name);
    expect(names).toContain("readme.txt");
    expect(names).toContain("docs");
  });

  it("refuses to list outside the root", async () => {
    await expect(connector().list("..")).rejects.toThrow(/not allowed/i);
    await expect(connector().list("../outside")).rejects.toThrow(/not allowed/i);
  });

  it("refuses to read outside the root", async () => {
    await expect(connector().download("../outside/secret.txt")).rejects.toThrow(/not allowed/i);
  });

  it("refuses to follow a symlink pointing out of the root", async () => {
    // The important case: "escape" is inside the root as a string, and
    // resolves to somewhere else entirely. A normalisation-only check passes
    // this and reads the file.
    const link = join(root, "escape");
    try {
      symlinkSync(outside, link, "junction");
    } catch {
      // Creating a symlink can require privileges on Windows. Skipping is
      // honest; asserting a check that never ran is not.
      return;
    }
    await expect(connector().download("escape/secret.txt")).rejects.toThrow(
      /outside the storage root/i
    );
    rmSync(link, { recursive: true, force: true });
  });

  it("refuses to delete the root itself", async () => {
    // No file-browser action should ever mean "wipe the share".
    await expect(connector().delete("")).rejects.toThrow(/cannot be deleted/i);
  });
});

describe("file operations", () => {
  it("uploads a stream and reads the same bytes back", async () => {
    const payload = "streamed content äöü";
    await connector().upload("uploaded.txt", Readable.from([Buffer.from(payload)]));
    expect(readFileSync(join(root, "uploaded.txt"), "utf8")).toBe(payload);

    const stream = await connector().download("uploaded.txt");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(payload);
  });

  it("creates nested folders", async () => {
    await connector().mkdir("a/b/c");
    const entry = await connector().stat("a/b/c");
    expect(entry?.isDirectory).toBe(true);
  });

  it("moves a file and leaves nothing behind", async () => {
    await connector().upload("to-move.txt", Readable.from([Buffer.from("x")]));
    await connector().move("to-move.txt", "docs/moved.txt");
    expect(await connector().stat("docs/moved.txt")).not.toBeNull();
    expect(await connector().stat("to-move.txt")).toBeNull();
  });

  it("copies without removing the original", async () => {
    await connector().upload("original.txt", Readable.from([Buffer.from("y")]));
    await connector().copy("original.txt", "docs/copied.txt");
    expect(await connector().stat("original.txt")).not.toBeNull();
    expect(await connector().stat("docs/copied.txt")).not.toBeNull();
  });

  it("reports directories with a null size rather than zero", async () => {
    const docs = (await connector().list("")).find((e) => e.name === "docs")!;
    // 0 would read as "an empty folder", which is a different claim.
    expect(docs.size).toBeNull();
    expect(docs.isDirectory).toBe(true);
  });

  it("refuses to move outside the root", async () => {
    await expect(connector().move("readme.txt", "../escaped.txt")).rejects.toThrow(/not allowed/i);
  });
});

describe("read-only mounts", () => {
  it("declares write capabilities as false", () => {
    expect(connector(true).capabilities().write).toBe(false);
    expect(connector(true).capabilities().read).toBe(true);
  });

  it("refuses every write operation", async () => {
    const ro = connector(true);
    await expect(ro.upload("nope.txt", Readable.from([Buffer.from("x")]))).rejects.toThrow(/read-only/i);
    await expect(ro.mkdir("nope")).rejects.toThrow(/read-only/i);
    await expect(ro.delete("readme.txt")).rejects.toThrow(/read-only/i);
    await expect(ro.move("readme.txt", "other.txt")).rejects.toThrow(/read-only/i);
  });

  it("still reads", async () => {
    expect((await connector(true).list("")).length).toBeGreaterThan(0);
  });

  it("reports read_only state from a probe", async () => {
    const probe = await connector(true).testConnection();
    expect(probe.state).toBe("read_only");
  });
});

describe("connection probe", () => {
  it("reports connected with real capacity", async () => {
    const probe = await connector().testConnection();
    expect(probe.state).toBe("connected");
    // A real figure from the filesystem, not a placeholder.
    expect(probe.usage.totalBytes).toBeGreaterThan(0);
    expect(probe.latencyMs).not.toBeNull();
  });

  it("confirms writability by actually writing", async () => {
    const probe = await connector().testConnection({ probeWrite: true });
    expect(probe.writable).toBe(true);
    // The probe file must not survive.
    const names = (await connector().list("")).map((e) => e.name);
    expect(names.some((n) => n.startsWith(".mailserver-write-probe"))).toBe(false);
  });

  it("reports unreachable for a path that does not exist", async () => {
    const missing = new LocalDirectoryConnector(join(root, "no-such-directory"));
    const probe = await missing.testConnection();
    expect(probe.state).toBe("unreachable");
    // No invented capacity on a failure.
    expect(probe.usage.totalBytes).toBeNull();
  });
});
