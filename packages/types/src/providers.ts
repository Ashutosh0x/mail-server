import type { ProviderDescriptor, ProviderId } from "./storage";

/**
 * The provider registry.
 *
 * `status: "available"` is a claim that a working connector exists behind it.
 * Everything else is `planned` with a reason, and the UI renders those as
 * unavailable rather than as a connect button that fails after the OAuth
 * round trip. A registry that lists fourteen logos and implements one is the
 * fake-connector problem with extra steps.
 *
 * Capabilities are what the PROVIDER supports, verified against its own API
 * documentation — not what our connector currently implements. The connector
 * declaring more than it does is the bug this table exists to prevent.
 */
export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  native: {
    id: "native",
    label: "Mail Server",
    status: "available",
    auth: "none",
    external: false,
    capabilities: [
      "read", "write", "delete", "rename", "move", "folders", "search",
      "versioning", "thumbnails", "previews", "sharing", "public_links",
      "permissions", "multipart_upload", "resumable_upload", "native_collaboration",
    ],
  },

  s3: {
    id: "s3",
    label: "S3-compatible storage",
    status: "planned",
    auth: "access_key",
    external: true,
    // No LIST-based rename or move: S3 has neither. A "rename" is a server-side
    // copy followed by a delete, which this connector will expose as a move
    // only once it implements both halves atomically enough to be honest.
    capabilities: [
      "read", "write", "delete", "folders", "multipart_upload",
      "server_side_copy", "public_links",
    ],
    note: "Connector not implemented. Covers AWS S3, R2, B2, MinIO, Ceph, Garage, Wasabi, Spaces.",
  },

  gcs: {
    id: "gcs",
    label: "Google Cloud Storage",
    status: "planned",
    auth: "access_key",
    external: true,
    capabilities: ["read", "write", "delete", "folders", "multipart_upload", "server_side_copy", "public_links"],
    note: "Connector not implemented.",
  },

  azure_blob: {
    id: "azure_blob",
    label: "Azure Blob Storage",
    status: "planned",
    auth: "access_key",
    external: true,
    capabilities: ["read", "write", "delete", "folders", "multipart_upload", "versioning", "public_links"],
    note: "Connector not implemented.",
  },

  google_drive: {
    id: "google_drive",
    label: "Google Drive",
    status: "planned",
    auth: "oauth2",
    external: true,
    // Drive supports push notifications on files/changes, so incremental sync
    // is possible without crawling — but only once the connector holds a
    // change token and a verified webhook endpoint.
    capabilities: [
      "read", "write", "delete", "rename", "move", "folders", "search",
      "versioning", "thumbnails", "previews", "sharing", "public_links",
      "permissions", "webhooks", "change_tracking", "resumable_upload",
      "native_collaboration",
    ],
    note: "Connector not implemented. Requires an OAuth client and a public webhook endpoint.",
  },

  onedrive: {
    id: "onedrive",
    label: "OneDrive",
    status: "planned",
    auth: "oauth2",
    external: true,
    capabilities: [
      "read", "write", "delete", "rename", "move", "folders", "search",
      "versioning", "thumbnails", "sharing", "permissions", "webhooks",
      "change_tracking", "resumable_upload",
    ],
    note: "Connector not implemented. Microsoft Graph.",
  },

  sharepoint: {
    id: "sharepoint",
    label: "SharePoint",
    status: "planned",
    auth: "oauth2",
    external: true,
    // Modelled separately from OneDrive on purpose: the permission models are
    // different, and treating a document library as a personal drive is how
    // site-level permissions get mistranslated.
    capabilities: [
      "read", "write", "delete", "rename", "move", "folders", "search",
      "versioning", "sharing", "permissions", "webhooks", "change_tracking",
    ],
    note: "Connector not implemented. Distinct from OneDrive — different permission model.",
  },

  dropbox: {
    id: "dropbox",
    label: "Dropbox",
    status: "planned",
    auth: "oauth2",
    external: true,
    capabilities: [
      "read", "write", "delete", "rename", "move", "folders", "search",
      "versioning", "thumbnails", "sharing", "public_links", "webhooks",
      "change_tracking", "resumable_upload",
    ],
    note: "Connector not implemented.",
  },

  box: {
    id: "box",
    label: "Box",
    status: "planned",
    auth: "oauth2",
    external: true,
    capabilities: [
      "read", "write", "delete", "rename", "move", "folders", "search",
      "versioning", "thumbnails", "sharing", "public_links", "permissions",
      "webhooks", "change_tracking",
    ],
    note: "Connector not implemented.",
  },

  egnyte: {
    id: "egnyte",
    label: "Egnyte",
    status: "planned",
    auth: "oauth2",
    external: true,
    capabilities: ["read", "write", "delete", "rename", "move", "folders", "search", "versioning", "sharing"],
    note: "Connector not implemented. Egnyte's own Google Workspace integration is marked legacy by Egnyte.",
  },

  webdav: {
    id: "webdav",
    label: "WebDAV",
    status: "planned",
    auth: "password",
    external: true,
    // No search: WebDAV's SEARCH method (RFC 5323) is optional and rarely
    // implemented, so claiming it would break against most servers.
    capabilities: ["read", "write", "delete", "rename", "move", "folders"],
    note: "Connector not implemented.",
  },

  sftp: {
    id: "sftp",
    label: "SFTP",
    status: "planned",
    auth: "ssh_key",
    external: true,
    capabilities: ["read", "write", "delete", "rename", "move", "folders"],
    note: "Connector not implemented.",
  },

  smb: {
    id: "smb",
    label: "SMB / CIFS",
    status: "planned",
    auth: "password",
    external: true,
    capabilities: ["read", "write", "delete", "rename", "move", "folders"],
    note: "Connector not implemented. Mounted server-side only — never from a browser.",
  },

  nfs: {
    id: "nfs",
    label: "NFS",
    status: "planned",
    auth: "mount",
    external: true,
    // NFSv4.2 has copy_file_range, which is a genuine server-side copy.
    capabilities: ["read", "write", "delete", "rename", "move", "folders", "server_side_copy"],
    note: "Connector not implemented. Requires a host mount; not configurable by end users.",
  },
};

export function providerDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDERS[id];
}

/** Providers with a working connector. The only ones offered as connectable. */
export function availableProviders(): ProviderDescriptor[] {
  return Object.values(PROVIDERS).filter((p) => p.status === "available" && p.external);
}

/** Named but not implemented. Listed so the roadmap is visible, never as a button. */
export function plannedProviders(): ProviderDescriptor[] {
  return Object.values(PROVIDERS).filter((p) => p.status === "planned");
}
