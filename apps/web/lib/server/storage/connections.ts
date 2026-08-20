import "server-only";
import { db, newId, nowIso } from "../db";
import { deriveKey, sealSecret, openSecret } from "../secrets";
import { LocalDirectoryConnector } from "./local-dir";
import { WebDavConnector } from "./webdav";
import type { StorageConnector } from "./connector";

/**
 * Storage connections: persistence, credential sealing, and authorisation.
 *
 * The rules this file exists to enforce, all of them in one place so no route
 * can forget one:
 *
 * 1. EVERY LOOKUP IS SCOPED BY TENANT AND OWNER. `connectionFor()` is the only
 *    way to obtain a connector, and it takes the caller's identity. There is
 *    no "load by id" that a route could reach for by mistake.
 *
 * 2. CREDENTIALS ARE SEALED WITH THE ROW ID AS AAD. A ciphertext lifted into
 *    another row fails to open, which defeats re-pointing one tenant's mount
 *    at another tenant's credentials.
 *
 * 3. CREDENTIALS NEVER LEAVE. `toPublic()` is the only shape that goes to a
 *    client, and it has no field that could hold one — not redacted, absent.
 */

export type ConnectionProviderId = "webdav" | "local";

export type StorageRole = "attachments" | "files" | "archive";

export interface StorageConnectionRecord {
  id: string;
  provider: ConnectionProviderId;
  displayName: string;
  status: string;
  statusDetail: string | null;
  /** Non-secret settings only. */
  config: Record<string, unknown>;
  rootPath: string | null;
  roles: StorageRole[];
  lastVerifiedAt: string | null;
  createdAt: string;
}

/** The only shape that reaches a browser. */
export interface PublicConnection {
  id: string;
  provider: ConnectionProviderId;
  displayName: string;
  status: string;
  statusDetail: string | null;
  roles: StorageRole[];
  lastVerifiedAt: string | null;
  createdAt: string;
  /** Enough to identify the target, never enough to authenticate to it. */
  target: string | null;
  readOnly: boolean;
}

interface WebDavSecrets {
  username: string;
  password: string;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: Record<string, unknown>): StorageConnectionRecord {
  return {
    id: row.id as string,
    provider: row.provider as ConnectionProviderId,
    displayName: row.display_name as string,
    status: (row.status as string) ?? "disconnected",
    statusDetail: (row.status_detail as string | null) ?? null,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    rootPath: (row.root_path as string | null) ?? null,
    roles: parseJson<StorageRole[]>(row.roles, []),
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function toPublic(record: StorageConnectionRecord): PublicConnection {
  return {
    id: record.id,
    provider: record.provider,
    displayName: record.displayName,
    status: record.status,
    statusDetail: record.statusDetail,
    roles: record.roles,
    lastVerifiedAt: record.lastVerifiedAt,
    createdAt: record.createdAt,
    // The URL or mount path, which the user typed and needs to recognise. Not
    // a credential, and never the sealed blob.
    target:
      record.provider === "webdav"
        ? ((record.config.url as string | undefined) ?? null)
        : record.rootPath,
    readOnly: record.config.readOnly === true,
  };
}

export function listConnections(tenantId: string, userId: string): StorageConnectionRecord[] {
  const rows = db()
    .prepare(
      `SELECT * FROM storage_connections
        WHERE organization_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)
        ORDER BY created_at DESC`
    )
    .all(tenantId, userId) as Record<string, unknown>[];
  return rows.map(toRecord);
}

/**
 * One connection the caller is entitled to.
 *
 * Ownership is in the WHERE clause, so another tenant's id selects nothing.
 * Callers turn null into a 404 — never a 403, which would confirm the id
 * exists.
 */
export function getConnection(
  tenantId: string,
  userId: string,
  id: string
): StorageConnectionRecord | null {
  const row = db()
    .prepare(
      `SELECT * FROM storage_connections
        WHERE id = ? AND organization_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)`
    )
    .get(id, tenantId, userId) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : null;
}

export function createConnection(input: {
  tenantId: string;
  userId: string;
  provider: ConnectionProviderId;
  displayName: string;
  config: Record<string, unknown>;
  rootPath?: string | null;
  secrets?: Record<string, string>;
}): StorageConnectionRecord {
  const id = newId();
  const now = nowIso();

  // Sealed against THIS row's id, so the ciphertext is useless in any other.
  const sealed = input.secrets
    ? sealSecret(JSON.stringify(input.secrets), id, deriveKey(process.env.SECRETS_KEY))
    : null;

  db()
    .prepare(
      `INSERT INTO storage_connections
         (id, organization_id, owner_user_id, provider, display_name, status,
          encrypted_credentials, config, root_path, roles, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'disconnected', ?, ?, ?, '[]', ?, ?)`
    )
    .run(
      id,
      input.tenantId,
      input.userId,
      input.provider,
      input.displayName,
      sealed,
      JSON.stringify(input.config),
      input.rootPath ?? null,
      now,
      now
    );

  return getConnection(input.tenantId, input.userId, id)!;
}

/** Record the outcome of a real probe. Status is never set optimistically. */
export function recordProbe(
  tenantId: string,
  userId: string,
  id: string,
  state: string,
  detail: string
): void {
  const verified = state === "connected" || state === "read_only";
  db()
    .prepare(
      `UPDATE storage_connections
          SET status = ?, status_detail = ?, updated_at = ?
              ${verified ? ", last_verified_at = ?" : ""}
        WHERE id = ? AND organization_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)`
    )
    .run(
      // The schema constrains `status`; connector states are mapped onto it.
      state === "connected" ? "active" : state === "read_only" ? "degraded"
        : state === "authentication_required" ? "auth_required"
        : state === "unreachable" ? "unreachable" : "disconnected",
      detail,
      nowIso(),
      ...(verified ? [nowIso()] : []),
      id,
      tenantId,
      userId
    );
}

export function renameConnection(
  tenantId: string,
  userId: string,
  id: string,
  displayName: string
): boolean {
  const result = db()
    .prepare(
      `UPDATE storage_connections SET display_name = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)`
    )
    .run(displayName, nowIso(), id, tenantId, userId);
  return Number(result.changes) > 0;
}

export function setRoles(
  tenantId: string,
  userId: string,
  id: string,
  roles: StorageRole[]
): boolean {
  const result = db()
    .prepare(
      `UPDATE storage_connections SET roles = ?, updated_at = ?
        WHERE id = ? AND organization_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)`
    )
    .run(JSON.stringify(roles), nowIso(), id, tenantId, userId);
  return Number(result.changes) > 0;
}

/**
 * Forget a connection.
 *
 * Deletes the RECORD ONLY. Nothing on the external storage is touched — a
 * disconnect that deleted a NAS full of files because someone tidied their
 * connection list would be indefensible.
 */
export function deleteConnection(tenantId: string, userId: string, id: string): boolean {
  const result = db()
    .prepare(
      `DELETE FROM storage_connections
        WHERE id = ? AND organization_id = ? AND (owner_user_id = ? OR owner_user_id IS NULL)`
    )
    .run(id, tenantId, userId);
  return Number(result.changes) > 0;
}

/**
 * Build a working connector for a connection the caller owns.
 *
 * The single door: there is no other exported way to get one, so an API route
 * cannot obtain a connector without having passed the ownership check.
 */
export function connectorFor(record: StorageConnectionRecord): StorageConnector {
  if (record.provider === "local") {
    if (!record.rootPath) throw new Error("That connection has no storage root.");
    return new LocalDirectoryConnector(record.rootPath, record.config.readOnly === true);
  }

  if (record.provider === "webdav") {
    const row = db()
      .prepare(`SELECT encrypted_credentials FROM storage_connections WHERE id = ?`)
      .get(record.id) as { encrypted_credentials: string | null } | undefined;

    if (!row?.encrypted_credentials) {
      throw new Error("That connection has no stored credentials.");
    }

    // Opened with the row id as AAD; a blob from another row will not decrypt.
    const secrets = JSON.parse(
      openSecret(row.encrypted_credentials, record.id, deriveKey(process.env.SECRETS_KEY))
    ) as WebDavSecrets;

    return new WebDavConnector({
      url: String(record.config.url ?? ""),
      username: secrets.username,
      password: secrets.password,
      basePath: record.config.basePath ? String(record.config.basePath) : undefined,
    });
  }

  throw new Error(`No connector is implemented for ${record.provider}.`);
}
