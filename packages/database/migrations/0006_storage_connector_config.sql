-- 0006_storage_connector_config.sql
--
-- `storage_connections` could already hold sealed credentials, but had nowhere
-- to keep the NON-secret half of a connection: a WebDAV URL, a bucket name, the
-- filesystem root a mounted-disk connection is confined to.
--
-- Kept in its own column rather than inside the sealed blob so that listing
-- connections does not require unsealing every one of them, and so that a
-- connection whose credentials fail to open can still be displayed and fixed
-- rather than becoming invisible.
--
-- Nothing secret belongs in here. Credentials stay in `encrypted_credentials`,
-- AES-256-GCM with the row id as AAD.

BEGIN;

ALTER TABLE storage_connections ADD COLUMN config TEXT NOT NULL DEFAULT '{}';

-- The root this connection may touch, for filesystem-backed connections.
-- Enforced server-side on every operation: a path outside it is refused rather
-- than clamped, because clamping turns a traversal attempt into a silent
-- write somewhere unexpected.
ALTER TABLE storage_connections ADD COLUMN root_path TEXT;

-- When the connection was last actually verified by a real probe, as opposed
-- to when the row was last written. "Connected" in the UI is derived from this.
ALTER TABLE storage_connections ADD COLUMN last_verified_at TEXT;

-- Which purposes this connection serves. JSON array: attachments, files,
-- archive. Empty means connected but not yet used for anything, which is the
-- correct default -- connecting storage must never silently redirect mail.
ALTER TABLE storage_connections ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';

COMMIT;
