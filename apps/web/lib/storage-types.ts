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
