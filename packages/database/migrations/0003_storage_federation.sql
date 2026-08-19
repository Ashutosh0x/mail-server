-- 0003_storage_federation.sql
--
-- External storage federation.
--
-- The distinction these tables encode: for an external provider, WE DO NOT OWN
-- THE BYTES. We hold a connection, where it is mounted, who can see the mount,
-- and an index of item metadata. Deleting a row here deletes our reference, not
-- the customer's file. Content only becomes ours when a user explicitly imports
-- it, at which point it is a native file with a row in `attachments`/Drive.

BEGIN;

CREATE TABLE storage_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL for an organization-owned connection created by an admin.
  owner_user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'disconnected'
                    CHECK (status IN ('active','degraded','auth_required','revoked','unreachable','disconnected')),
  status_detail   TEXT,
  -- AES-256-GCM envelope; the row id is the AAD, so a blob moved to another
  -- row fails to decrypt. A dump of this table is not a usable credential set.
  encrypted_credentials TEXT,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX storage_connections_org_idx ON storage_connections(organization_id);
CREATE INDEX storage_connections_owner_idx ON storage_connections(owner_user_id);
CREATE TRIGGER storage_connections_updated_at BEFORE UPDATE ON storage_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE storage_mounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES storage_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  root_path       TEXT NOT NULL DEFAULT '/',
  -- 'private' is the default deliberately: connecting a personal account must
  -- never make it visible to the whole organization.
  visibility      TEXT NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private','organization','group','users')),
  granted_group_ids UUID[] NOT NULL DEFAULT '{}',
  granted_user_ids  UUID[] NOT NULL DEFAULT '{}',
  -- Ceiling this mount imposes regardless of what the provider would allow.
  max_role        TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (max_role IN ('viewer','commenter','contributor','content_manager','manager')),
  indexing        TEXT NOT NULL DEFAULT 'metadata'
                    CHECK (indexing IN ('disabled','metadata','metadata_and_text','full_content')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX storage_mounts_connection_idx ON storage_mounts(connection_id);
CREATE INDEX storage_mounts_org_idx ON storage_mounts(organization_id);

CREATE TABLE storage_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES storage_connections(id) ON DELETE CASCADE,
  -- The provider's own id. Unique only WITHIN a connection — never a primary
  -- key, because two providers will eventually collide on one.
  external_id     TEXT NOT NULL,
  parent_external_id TEXT,
  name            TEXT NOT NULL,
  mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes      BIGINT,
  is_folder       BOOLEAN NOT NULL DEFAULT false,
  modified_at     TIMESTAMPTZ,
  web_url         TEXT,
  indexed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX storage_items_parent_idx ON storage_items(connection_id, parent_external_id);

CREATE TABLE storage_sync_states (
  connection_id   UUID PRIMARY KEY REFERENCES storage_connections(id) ON DELETE CASCADE,
  -- The provider's change cursor. Incremental sync depends on it; re-crawling
  -- an entire Drive on every poll is what it exists to avoid.
  change_cursor   TEXT,
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  items_indexed   BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
