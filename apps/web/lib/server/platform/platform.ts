import "server-only";
import { arch, homedir, platform, release, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The one place that knows which operating system this is.
 *
 * Everything else asks this module. `process.platform === "win32"` scattered
 * through business logic is how a codebase quietly becomes three codebases:
 * each check is a small decision made in isolation, and they drift until
 * Windows and Linux behave differently for reasons nobody intended.
 *
 * The rule is that PRODUCT CODE DESCRIBES WHAT IT NEEDS, and an adapter
 * decides how the platform provides it. "Where do logs go" is a product
 * question; `%LOCALAPPDATA%` versus `~/.local/state` is an adapter answer.
 */

export type PlatformId = "windows" | "linux" | "macos" | "unsupported";

/** Node's identifiers, normalised. Product code should never see "win32". */
export function platformId(): PlatformId {
  switch (platform()) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    default:
      return "unsupported";
  }
}

export type ArchitectureId = "x64" | "arm64" | "other";

export function architecture(): ArchitectureId {
  const value = arch();
  if (value === "x64") return "x64";
  if (value === "arm64") return "arm64";
  return "other";
}

export interface PlatformInfo {
  platform: PlatformId;
  /** Raw value, for logs and bug reports where the exact string matters. */
  rawPlatform: string;
  architecture: ArchitectureId;
  rawArchitecture: string;
  osRelease: string;
  nodeVersion: string;
  /** True for a platform this project actually supports and tests. */
  supported: boolean;
}

export function platformInfo(): PlatformInfo {
  const id = platformId();
  return {
    platform: id,
    rawPlatform: platform(),
    architecture: architecture(),
    rawArchitecture: arch(),
    osRelease: release(),
    nodeVersion: process.version,
    supported: id !== "unsupported",
  };
}

/**
 * Where the application keeps its files.
 *
 * Each platform has a convention, and following it is not cosmetic: on Windows
 * writing to the install directory breaks under UAC, and on macOS a config
 * file under `~/.config` is invisible to every tool a Mac user has.
 *
 * Every directory can be overridden by an environment variable, because a
 * container, a service account and a developer all want different answers and
 * none of them should have to patch code.
 *
 *   Windows  %LOCALAPPDATA%\MailServer\{data,config,logs,storage}
 *   macOS    ~/Library/Application Support/MailServer, ~/Library/Logs/MailServer
 *   Linux    XDG: ~/.local/share, ~/.config, ~/.local/state
 */
export interface DataDirectories {
  data: string;
  config: string;
  logs: string;
  storage: string;
  cache: string;
  temp: string;
}

const APP = "MailServer";

function windowsDirectories(): DataDirectories {
  // LOCALAPPDATA rather than APPDATA: this is machine-local state, not
  // something that should follow a roaming profile across machines.
  const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const root = join(base, APP);
  return {
    data: root,
    config: join(root, "config"),
    logs: join(root, "logs"),
    storage: join(root, "storage"),
    cache: join(base, APP, "cache"),
    temp: tmpdir(),
  };
}

function macosDirectories(): DataDirectories {
  const support = join(homedir(), "Library", "Application Support", APP);
  return {
    data: support,
    config: join(support, "config"),
    // macOS keeps logs somewhere Console.app can find them.
    logs: join(homedir(), "Library", "Logs", APP),
    storage: join(support, "storage"),
    cache: join(homedir(), "Library", "Caches", APP),
    temp: tmpdir(),
  };
}

function linuxDirectories(): DataDirectories {
  // XDG Base Directory, with the specification's own documented fallbacks.
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const cacheHome = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return {
    data: join(dataHome, APP),
    config: join(configHome, APP),
    logs: join(stateHome, APP, "logs"),
    storage: join(dataHome, APP, "storage"),
    cache: join(cacheHome, APP),
    temp: tmpdir(),
  };
}

export function dataDirectories(): DataDirectories {
  const defaults =
    platformId() === "windows"
      ? windowsDirectories()
      : platformId() === "macos"
        ? macosDirectories()
        : linuxDirectories();

  // Explicit configuration always wins. A container sets these; a developer
  // may too, and neither should need to know the platform convention.
  return {
    data: process.env.MAILSERVER_DATA_DIR ?? defaults.data,
    config: process.env.MAILSERVER_CONFIG_DIR ?? defaults.config,
    logs: process.env.MAILSERVER_LOG_DIR ?? defaults.logs,
    storage: process.env.MAILSERVER_STORAGE_DIR ?? defaults.storage,
    cache: process.env.MAILSERVER_CACHE_DIR ?? defaults.cache,
    temp: process.env.MAILSERVER_TEMP_DIR ?? defaults.temp,
  };
}

/**
 * The separator for a list of paths in one environment variable.
 *
 * `;` on Windows and `:` elsewhere, matching how PATH is written — a Windows
 * path contains a colon, so splitting on one would cut `C:\data` in half.
 */
export function pathListSeparator(): string {
  return platformId() === "windows" ? ";" : ":";
}

/** How to describe that separator to a person configuring the server. */
export function pathListSeparatorName(): string {
  return platformId() === "windows" ? "semicolons" : "colons";
}
