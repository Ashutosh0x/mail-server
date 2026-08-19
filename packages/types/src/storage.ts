/**
 * Storage federation contract.
 *
 * Two storage modes, and the difference is who owns the bytes:
 *
 *   NATIVE   — Mail Server wrote the object and can serve it without asking
 *              anyone. Deleting the row deletes the data.
 *   EXTERNAL — a remote provider is the source of truth. We hold metadata, an
 *              index entry and a permission mapping. Deleting our row deletes
 *              our reference, never their file.
 *
 * That distinction drives everything else here: capability negotiation exists
 * because external providers differ, and the effective-permission rule exists
 * because holding a valid provider token is not the same as being allowed to
 * read a file.
 */

export type StorageMode = "native" | "external";

/**
 * Every provider we can name. Being in this list is NOT a claim that a
 * connector exists — see `ProviderStatus`. A name with no implementation is
 * shown as unavailable rather than as a button that fails.
 */
export type ProviderId =
  | "native"
  | "s3"
  | "gcs"
  | "azure_blob"
  | "google_drive"
  | "onedrive"
  | "sharepoint"
  | "dropbox"
  | "box"
  | "egnyte"
  | "webdav"
  | "sftp"
  | "smb"
  | "nfs";

/**
 * Implementation state, surfaced to the UI verbatim.
 *
 * `planned` renders as "Not available" with no connect button. The alternative
 * — a button that opens an OAuth dialog for a connector that cannot list files
 * — is the exact failure the brief calls out.
 */
export type ProviderStatus = "available" | "planned";

/**
 * What a connector can actually do.
 *
 * Declared per provider and enforced twice: the UI hides actions the connector
 * lacks, and the API rejects them. A capability absent here is not a missing
 * feature to work around — it is the provider genuinely not supporting the
 * operation, and pretending otherwise produces a button that returns 500.
 */
export type Capability =
  | "read"
  | "write"
  | "delete"
  | "rename"
  | "move"
  | "folders"
  | "search"
  | "versioning"
  | "thumbnails"
  | "previews"
  | "sharing"
  | "public_links"
  | "permissions"
  | "webhooks"
  | "change_tracking"
  | "multipart_upload"
  | "resumable_upload"
  | "server_side_copy"
  | "native_collaboration";

export interface ProviderDescriptor {
  id: ProviderId;
  /** Product name as the vendor writes it. */
  label: string;
  status: ProviderStatus;
  /** How credentials are obtained. Drives which connect form is shown. */
  auth: "none" | "oauth2" | "access_key" | "password" | "ssh_key" | "mount";
  capabilities: readonly Capability[];
  /**
   * True when the provider keeps the bytes. Only `native` is false, and the
   * UI uses this to decide whether "Import to Drive" is meaningful.
   */
  external: boolean;
  /** Why a `planned` provider is not available yet. Shown to admins. */
  note?: string;
}

export function hasCapability(descriptor: ProviderDescriptor, capability: Capability): boolean {
  return descriptor.capabilities.includes(capability);
}

// ── Connections and mounts ─────────────────────────────────────────────────

export type ConnectionState =
  | "active"
  | "degraded"
  | "auth_required"
  | "revoked"
  | "unreachable"
  | "disconnected";

export interface StorageConnection {
  id: string;
  organizationId: string;
  /** Null for an organization-owned connection created by an admin. */
  ownerUserId: string | null;
  provider: ProviderId;
  displayName: string;
  state: ConnectionState;
  /** Free-text detail for a non-active state, e.g. the provider's own error. */
  stateDetail: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

/**
 * Who a mount is visible to.
 *
 * `private` is the default and the only safe one: connecting a personal
 * Dropbox must not expose it to the whole organization, which is the specific
 * failure the brief calls out.
 */
export type MountVisibility = "private" | "organization" | "group" | "users";

export interface StorageMount {
  id: string;
  connectionId: string;
  organizationId: string;
  /** Where this appears under External Storage. */
  name: string;
  /** Path inside the provider that the mount is rooted at. */
  rootPath: string;
  visibility: MountVisibility;
  /** Populated for `group` / `users` visibility. */
  grantedGroupIds: string[];
  grantedUserIds: string[];
  /** Ceiling this mount imposes, regardless of what the provider allows. */
  maxRole: MountRole;
  indexing: IndexingMode;
  createdAt: string;
}

/** Shared-drive and mount roles, ordered least to most privileged. */
export type MountRole = "viewer" | "commenter" | "contributor" | "content_manager" | "manager";

export const ROLE_ORDER: readonly MountRole[] = [
  "viewer",
  "commenter",
  "contributor",
  "content_manager",
  "manager",
] as const;

export function roleRank(role: MountRole): number {
  return ROLE_ORDER.indexOf(role);
}

/** The weaker of two roles. Used to intersect permission layers. */
export function weakerRole(a: MountRole, b: MountRole): MountRole {
  return roleRank(a) <= roleRank(b) ? a : b;
}

/** How much of an external file we are allowed to put in the search index. */
export type IndexingMode = "disabled" | "metadata" | "metadata_and_text" | "full_content";

// ── Effective permission ───────────────────────────────────────────────────

/** What the provider itself says this identity may do with this item. */
export interface ProviderGrant {
  /** False when the provider denies access outright. */
  readable: boolean;
  writable: boolean;
  deletable: boolean;
}

export interface AccessRequest {
  /** The caller's tenant. */
  userOrganizationId: string;
  userId: string;
  userGroupIds: string[];
  mount: StorageMount;
  connection: StorageConnection;
  descriptor: ProviderDescriptor;
  grant: ProviderGrant;
}

export interface EffectiveAccess {
  allowed: boolean;
  role: MountRole | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  /** Why access was denied or reduced. Shown to the user, logged for audit. */
  reason: string;
}

/**
 * The rule the whole federation layer rests on:
 *
 *     tenant ∧ mount ∧ provider = effective access
 *
 * Each layer can only ever REMOVE permission. A valid provider token does not
 * grant an Mail Server user anything, and an Mail Server role does not
 * override the provider saying no. Written as one function, in the contract
 * package, so every call site computes it identically — three implementations
 * of this would be three chances to get it wrong in one direction only.
 */
export function effectiveAccess(request: AccessRequest): EffectiveAccess {
  const deny = (reason: string): EffectiveAccess => ({
    allowed: false,
    role: null,
    canRead: false,
    canWrite: false,
    canDelete: false,
    reason,
  });

  // Layer 1 — tenant. A mount belongs to exactly one organization.
  if (request.mount.organizationId !== request.userOrganizationId) {
    return deny("This mount belongs to a different organization.");
  }
  if (request.connection.organizationId !== request.userOrganizationId) {
    return deny("This connection belongs to a different organization.");
  }

  // A connection that is not usable cannot grant access through a stale mount.
  if (request.connection.state !== "active") {
    return deny(`The storage connection is ${request.connection.state.replace("_", " ")}.`);
  }

  // Layer 2 — mount visibility.
  const visible = (() => {
    switch (request.mount.visibility) {
      case "organization":
        return true;
      case "private":
        // Only the person who connected it. An organization-owned connection
        // has no owner, so a private mount on one is visible to nobody until
        // its visibility is widened deliberately.
        return request.connection.ownerUserId === request.userId;
      case "users":
        return request.mount.grantedUserIds.includes(request.userId);
      case "group":
        return request.mount.grantedGroupIds.some((id) => request.userGroupIds.includes(id));
    }
  })();
  if (!visible) return deny("You do not have access to this mount.");

  // Layer 3 — the provider. Its answer is final in the restrictive direction.
  if (!request.grant.readable) {
    return deny("The storage provider denied access to this item.");
  }

  // Capability is a property of the connector, not of the user. A provider
  // that cannot delete makes deletion impossible for a manager too.
  const canWrite =
    request.grant.writable &&
    hasCapability(request.descriptor, "write") &&
    roleRank(request.mount.maxRole) >= roleRank("contributor");

  const canDelete =
    request.grant.deletable &&
    hasCapability(request.descriptor, "delete") &&
    roleRank(request.mount.maxRole) >= roleRank("content_manager");

  return {
    allowed: true,
    role: request.mount.maxRole,
    canRead: true,
    canWrite,
    canDelete,
    reason: "Granted by tenant, mount and provider.",
  };
}

// ── Unified item ───────────────────────────────────────────────────────────

/**
 * A file or folder, normalised across providers.
 *
 * `id` is ours and globally unique; `externalId` is the provider's and is only
 * unique within one connection. Keying anything on `externalId` alone collides
 * the moment a second provider is connected.
 */
export interface StorageItem {
  id: string;
  connectionId: string;
  provider: ProviderId;
  externalId: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  isFolder: boolean;
  parentExternalId: string | null;
  modifiedAt: string | null;
  /** Provider's own URL for the item, when it has one. */
  webUrl: string | null;
  mode: StorageMode;
}
