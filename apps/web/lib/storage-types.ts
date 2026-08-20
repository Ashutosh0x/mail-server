/**
 * Shapes returned by the storage discovery API.
 *
 * Mirrors `lib/server/storage/discovery.ts`, kept separate so the browser
 * bundle never imports a module marked `server-only`.
 */

export type DiscoveredKind = "local" | "usb" | "smb" | "nfs" | "webdav" | "unknown";

export interface DiscoveredResource {
  id: string;
  type: DiscoveredKind;
  name: string;
  hostname: string | null;
  protocol: string;
  path: string;
  source: string | null;
  capacity: {
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
  };
  readOnly: boolean | null;
  requiresAuthentication: boolean;
  connectionStatus: "available" | "unreachable";
  detectedAt: string;
}

export interface DiscoveryResult {
  resources: DiscoveredResource[];
  capabilities: {
    mountedFilesystems: boolean;
    mdns: false;
    ssdp: false;
    platform: string;
  };
  errors: string[];
}

/** Mirrors `lib/server/storage/connector.ts`. */
export interface StorageEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  modifiedAt: string | null;
  contentType: string | null;
}

export interface ConnectorCapabilities {
  read: boolean;
  write: boolean;
  move: boolean;
  copy: boolean;
  mkdir: boolean;
  usage: boolean;
}

export type StorageRole = "attachments" | "files" | "archive";

export interface PublicConnection {
  id: string;
  provider: "webdav" | "local";
  displayName: string;
  status: string;
  statusDetail: string | null;
  roles: StorageRole[];
  lastVerifiedAt: string | null;
  createdAt: string;
  target: string | null;
  readOnly: boolean;
}

export interface ConnectionProbe {
  state: string;
  detail: string;
  usage: { totalBytes: number | null; usedBytes: number | null; freeBytes: number | null };
  latencyMs: number | null;
  writable: boolean | null;
}
