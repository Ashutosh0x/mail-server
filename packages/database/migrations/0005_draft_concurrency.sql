-- 0005_draft_concurrency.sql
--
-- Optimistic concurrency for drafts.
--
-- A draft is edited from more than one place: two browser tabs, a phone and a
-- laptop, or an autosave racing a manual save. Without a version there is no
-- way to tell "this save is based on what is currently stored" from "this save
-- is based on something older", and the loser silently overwrites the winner.
--
-- `version` increments on every save. A client sends the version it read; a
-- mismatch is a conflict the caller resolves, never a silent overwrite.
--
-- `updated_at` exists on most tables here but was missing from `messages`,
-- which meant a draft's last-saved time could only be inferred from the
-- thread. Autosave needs to show it directly.

BEGIN;

ALTER TABLE messages ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN updated_at TIMESTAMPTZ;

COMMIT;
