import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { platform } from "node:os";
import { delimiter } from "node:path";
import {
  architecture,
  dataDirectories,
  pathListSeparator,
  pathListSeparatorName,
  platformId,
  platformInfo,
} from "./platform";
import { normaliseError, statusFor } from "./errors";

/**
 * The platform layer.
 *
 * These run on every OS in CI and must pass on all of them — that is the whole
 * point. Assertions are therefore written against what the CURRENT platform
 * should produce, rather than hardcoding one platform's answer, so a Windows
 * pass and a Linux pass mean the same thing.
 */

describe("platform identification", () => {
  it("normalises the running platform, never exposing win32 or darwin", () => {
    const id = platformId();
    expect(["windows", "linux", "macos", "unsupported"]).toContain(id);

    const expected =
      platform() === "win32"
        ? "windows"
        : platform() === "darwin"
          ? "macos"
          : platform() === "linux"
            ? "linux"
            : "unsupported";
    expect(id).toBe(expected);
  });

  it("keeps the raw value for logs, where the exact string matters", () => {
    expect(platformInfo().rawPlatform).toBe(platform());
  });

  it("reports an architecture from the supported set", () => {
    expect(["x64", "arm64", "other"]).toContain(architecture());
  });

  it("marks the three target platforms as supported", () => {
    const info = platformInfo();
    // CI runs windows-latest, ubuntu-latest and macos-latest, so this asserts
    // the matrix itself is on a supported platform.
    if (["windows", "linux", "macos"].includes(info.platform)) {
      expect(info.supported).toBe(true);
    }
  });
});

describe("path list separator", () => {
  it("matches the platform's own delimiter", () => {
    // Node already knows the answer; agreeing with it is the correctness test.
    // A colon on Windows would cut "C:\data" in half.
    expect(pathListSeparator()).toBe(delimiter);
  });

  it("describes the separator in words for configuration messages", () => {
    expect(pathListSeparatorName()).toBe(platformId() === "windows" ? "semicolons" : "colons");
  });
});

describe("data directories", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns absolute paths for every directory", () => {
    const directories = dataDirectories();
    for (const [name, value] of Object.entries(directories)) {
      expect(value.length, name).toBeGreaterThan(0);
      // A relative path here would resolve differently depending on where the
      // process happened to be started from.
      expect(
        value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value),
        `${name} should be absolute, got ${value}`
      ).toBe(true);
    }
  });

  it("follows the platform's own convention", () => {
    const { data, logs } = dataDirectories();
    if (platformId() === "windows") {
      expect(data).toMatch(/MailServer/);
      // Machine-local state, not something to roam between machines.
      expect(data.toLowerCase()).toContain("local");
    } else if (platformId() === "macos") {
      // Where a Mac user and Console.app expect to find them.
      expect(data).toContain("Library");
      expect(logs).toContain("Library");
    } else if (platformId() === "linux") {
      expect(data).toMatch(/\.local[\\/]share|share/);
    }
  });

  it("lets an explicit setting override every default", () => {
    // A container, a service account and a developer all want different
    // answers, and none of them should have to patch code.
    process.env.MAILSERVER_DATA_DIR = "/custom/data";
    process.env.MAILSERVER_LOG_DIR = "/custom/logs";
    process.env.MAILSERVER_STORAGE_DIR = "/custom/storage";
    const directories = dataDirectories();
    expect(directories.data).toBe("/custom/data");
    expect(directories.logs).toBe("/custom/logs");
    expect(directories.storage).toBe("/custom/storage");
  });

  it("keeps directories distinct, so logs cannot land in the database folder", () => {
    const { data, config, logs, storage } = dataDirectories();
    expect(new Set([data, config, logs, storage]).size).toBe(4);
  });
});

describe("error normalisation", () => {
  const err = (code: string) => Object.assign(new Error("raw"), { code });

  it("maps POSIX codes to product categories", () => {
    expect(normaliseError(err("ENOENT")).kind).toBe("not_found");
    expect(normaliseError(err("EACCES")).kind).toBe("permission_denied");
    expect(normaliseError(err("EROFS")).kind).toBe("read_only");
    expect(normaliseError(err("ENOSPC")).kind).toBe("out_of_space");
    expect(normaliseError(err("ETIMEDOUT")).kind).toBe("timeout");
  });

  it("maps the Windows spelling of the same problems", () => {
    // EPERM is what Windows usually reports for a locked or read-only file.
    expect(normaliseError(err("EPERM")).kind).toBe("permission_denied");
    expect(normaliseError(err("EBUSY")).kind).toBe("busy");
    expect(normaliseError(new Error("Access is denied.")).kind).toBe("permission_denied");
    expect(normaliseError(new Error("The network path was not found.")).kind).toBe("unavailable");
  });

  it("never leaks the raw code into the user-facing message", () => {
    for (const code of ["ENOENT", "EACCES", "EPERM", "EBUSY", "ENOSPC", "ESTALE"]) {
      const normalised = normaliseError(err(code));
      expect(normalised.message).not.toContain(code);
      // The original is kept for the server log, where it belongs.
      expect(normalised.code).toBe(code);
    }
  });

  it("says something safe for an error it does not recognise", () => {
    const normalised = normaliseError(new Error("C:\\Users\\someone\\secret\\path failed"));
    expect(normalised.kind).toBe("unknown");
    // A raw error often carries the full server path.
    expect(normalised.message).not.toContain("secret");
  });

  it("passes through messages this codebase wrote for people", () => {
    const message = "That path is outside the storage root.";
    expect(normaliseError(new Error(message)).message).toBe(message);
  });

  it("maps categories onto sensible HTTP statuses", () => {
    expect(statusFor("not_found")).toBe(404);
    expect(statusFor("permission_denied")).toBe(403);
    expect(statusFor("read_only")).toBe(403);
    expect(statusFor("out_of_space")).toBe(507);
    expect(statusFor("unavailable")).toBe(502);
    expect(statusFor("already_exists")).toBe(409);
  });
});
