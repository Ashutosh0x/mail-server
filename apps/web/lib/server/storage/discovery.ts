import "server-only";
import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Storage discovery.
 *
 * Discovery happens HERE, on the server, because a browser cannot enumerate
 * anything on the host or the local network — and a UI that appears to do so
 * is showing invented data. What this module reports is what the operating
 * system running the mail server actually says is mounted.
 *
 * Scope, stated honestly:
 *
 *   - MOUNTED FILESYSTEMS are discovered for real, by asking the OS. On Linux
 *     that is /proc/mounts, on Windows it is PowerShell's volume list, on
 *     macOS it is `mount`. Capacity comes from `statfs`, not from a guess.
 *
 *   - NETWORK MOUNTS already attached to the host are discovered, because to
 *     the OS they are just filesystems with a remote source. An SMB share
 *     mounted at /mnt/nas is reported as SMB with its remote path.
 *
 *   - UNMOUNTED LAN DEVICES ARE NOT DISCOVERED. Finding a NAS nobody has
 *     mounted needs mDNS/DNS-SD or SSDP, which are not implemented here. They
 *     are absent rather than faked: `mdns: false` in the capability report,
 *     and the UI offers manual connection instead. Scanning IP ranges is
 *     deliberately not done — it is slow, hostile on shared networks, and
 *     frequently indistinguishable from an attack.
 *
 * Nothing in this file invents a device, a vendor or a capacity.
 */

export type DiscoveredKind = "local" | "usb" | "smb" | "nfs" | "webdav" | "unknown";

export interface DiscoveredResource {
  /** Stable across scans for the same mount, so the UI can track it. */
  id: string;
  type: DiscoveredKind;
  name: string;
  /** Remote host, when the filesystem has one. Null for local disks. */
  hostname: string | null;
  protocol: string;
  /** Mount point on the host, or the remote export path. */
  path: string;
  /** Remote share as the OS records it, e.g. //nas/media. Null when local. */
  source: string | null;
  capacity: {
    totalBytes: number | null;
    freeBytes: number | null;
    /** Null where the platform does not say, never a guess. */
    usedBytes: number | null;
  };
  readOnly: boolean | null;
  requiresAuthentication: boolean;
  /** Already mounted and readable by this process, or not. */
  connectionStatus: "available" | "unreachable";
  detectedAt: string;
}

export interface DiscoveryResult {
  resources: DiscoveredResource[];
  /** What this host can and cannot discover, so the UI states it plainly. */
  capabilities: {
    mountedFilesystems: boolean;
    /** Service discovery for unmounted LAN devices. Not implemented. */
    mdns: false;
    ssdp: false;
    platform: string;
  };
  /** Populated when discovery itself failed, rather than finding nothing. */
  errors: string[];
}

/** Network filesystem types, as the OS names them in a mount table. */
const NETWORK_TYPES: Record<string, DiscoveredKind> = {
  cifs: "smb",
  smb: "smb",
  smbfs: "smb",
  smb2: "smb",
  smb3: "smb",
  nfs: "nfs",
  nfs4: "nfs",
  davfs: "webdav",
  davfs2: "webdav",
  webdav: "webdav",
};

/** Pseudo-filesystems that are not storage in any useful sense. */
const IGNORED_TYPES = new Set([
  "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2", "securityfs",
  "debugfs", "tracefs", "pstore", "bpf", "configfs", "fusectl", "hugetlbfs", "mqueue",
  "autofs", "binfmt_misc", "efivarfs", "ramfs", "squashfs", "overlay", "nsfs", "rpc_pipefs",
]);

function idFor(path: string): string {
  // Deterministic, so the same mount keeps its id between scans.
  return "mnt:" + Buffer.from(path).toString("base64url");
}

async function capacityOf(path: string): Promise<DiscoveredResource["capacity"]> {
  try {
    const stats = await statfs(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(total) || total <= 0) {
      return { totalBytes: null, freeBytes: null, usedBytes: null };
    }
    return {
      totalBytes: total,
      freeBytes: Number.isFinite(free) ? free : null,
      usedBytes: Number.isFinite(free) ? total - free : null,
    };
  } catch {
    // A mount can exist and be unreadable — a disconnected network share is
    // the usual case. Reported as unknown rather than zero.
    return { totalBytes: null, freeBytes: null, usedBytes: null };
  }
}

/** Linux: /proc/mounts is the kernel's own view, and needs no external tool. */
async function discoverLinux(): Promise<DiscoveredResource[]> {
  const content = await readFile("/proc/mounts", "utf8");
  const seen = new Set<string>();
  const out: DiscoveredResource[] = [];

  for (const line of content.split("\n")) {
    const [rawSource, rawTarget, fsType, rawOptions] = line.split(/\s+/);
    if (!rawSource || !rawTarget || !fsType) continue;
    if (IGNORED_TYPES.has(fsType)) continue;
    if (seen.has(rawTarget)) continue;
    seen.add(rawTarget);

    // Octal escapes for spaces and tabs, as mount tables encode them.
    const target = rawTarget.replace(/\\040/g, " ").replace(/\\011/g, "\t");
    const source = rawSource.replace(/\\040/g, " ");
    const kind = NETWORK_TYPES[fsType] ?? (/^\/dev\/(sd|nvme|mmc)/.test(source) ? "local" : "unknown");

    // A remote source looks like //host/share or host:/export.
    const host =
      /^\/\/([^/]+)\//.exec(source)?.[1] ?? /^([^/:]+):\//.exec(source)?.[1] ?? null;

    const capacity = await capacityOf(target);
    out.push({
      id: idFor(target),
      type: kind,
      name: target,
      hostname: host,
      protocol: fsType,
      path: target,
      source: host ? source : null,
      capacity,
      readOnly: (rawOptions ?? "").split(",").includes("ro"),
      // It is already mounted, so the host has whatever credentials it needed.
      requiresAuthentication: false,
      connectionStatus: capacity.totalBytes === null ? "unreachable" : "available",
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Windows: PowerShell reports volumes including mapped network drives.
 *
 * `Get-Volume` alone misses network drives, so `Get-CimInstance Win32_LogicalDisk`
 * is used — DriveType 4 is a network mount and 2 is removable.
 */
async function discoverWindows(): Promise<DiscoveredResource[]> {
  const script =
    "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,FileSystem,Size,FreeSpace,VolumeName,ProviderName | ConvertTo-Json -Compress";
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }
  );

  const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
  const disks = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
  const out: DiscoveredResource[] = [];

  for (const disk of disks) {
    const deviceId = String(disk.DeviceID ?? "");
    if (!deviceId) continue;

    const driveType = Number(disk.DriveType ?? 0);
    // 2 removable, 3 fixed, 4 network. 5 is optical, which is not storage to
    // write mail attachments into.
    if (![2, 3, 4].includes(driveType)) continue;

    const provider = disk.ProviderName ? String(disk.ProviderName) : null;
    const size = Number(disk.Size ?? 0);
    const free = Number(disk.FreeSpace ?? 0);
    const host = provider ? (/^\\\\([^\\]+)\\/.exec(provider)?.[1] ?? null) : null;

    out.push({
      id: idFor(deviceId),
      type: driveType === 4 ? "smb" : driveType === 2 ? "usb" : "local",
      name: String(disk.VolumeName || deviceId),
      hostname: host,
      protocol: driveType === 4 ? "smb" : String(disk.FileSystem ?? "unknown"),
      path: deviceId + "\\",
      source: provider,
      capacity: {
        totalBytes: size > 0 ? size : null,
        freeBytes: size > 0 ? free : null,
        usedBytes: size > 0 ? size - free : null,
      },
      // Windows does not report per-volume read-only state here, so this stays
      // null rather than being assumed writable.
      readOnly: null,
      requiresAuthentication: false,
      connectionStatus: size > 0 ? "available" : "unreachable",
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}

/** macOS and other BSDs: `mount` output, which names the type in parentheses. */
async function discoverBsd(): Promise<DiscoveredResource[]> {
  const { stdout } = await run("mount", [], { timeout: 15_000 });
  const out: DiscoveredResource[] = [];

  for (const line of stdout.split("\n")) {
    const match = /^(\S+) on (.+?) \(([^,)]+)/.exec(line.trim());
    if (!match) continue;
    const [, source, target, fsType] = match as unknown as [string, string, string, string];
    if (IGNORED_TYPES.has(fsType)) continue;

    const kind = NETWORK_TYPES[fsType] ?? "local";
    const host = /^\/\/(?:[^@]+@)?([^/]+)\//.exec(source)?.[1] ?? /^([^/:]+):\//.exec(source)?.[1] ?? null;
    const capacity = await capacityOf(target);

    out.push({
      id: idFor(target),
      type: kind,
      name: target,
      hostname: host,
      protocol: fsType,
      path: target,
      source: host ? source : null,
      capacity,
      readOnly: /\bread-only\b/.test(line),
      requiresAuthentication: false,
      connectionStatus: capacity.totalBytes === null ? "unreachable" : "available",
      detectedAt: new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Everything the host can actually see.
 *
 * Never throws: a discovery failure is reported in `errors` with an empty
 * resource list, because "we could not look" and "there is nothing" are
 * different answers and the UI says which.
 */
export async function discoverStorage(): Promise<DiscoveryResult> {
  const errors: string[] = [];
  let resources: DiscoveredResource[] = [];

  try {
    if (process.platform === "linux") resources = await discoverLinux();
    else if (process.platform === "win32") resources = await discoverWindows();
    else if (process.platform === "darwin" || process.platform === "freebsd") {
      resources = await discoverBsd();
    } else {
      errors.push(`Storage discovery is not implemented for ${process.platform}.`);
    }
  } catch (cause) {
    errors.push(
      cause instanceof Error
        ? `Could not read the host's mount table: ${cause.message}`
        : "Could not read the host's mount table."
    );
  }

  return {
    resources,
    capabilities: {
      mountedFilesystems: errors.length === 0,
      // Not implemented. Stated as a fact rather than left for the UI to guess.
      mdns: false,
      ssdp: false,
      platform: process.platform,
    },
    errors,
  };
}
