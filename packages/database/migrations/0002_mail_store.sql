-- 0002_mail_store.sql
--
-- The mail store itself.
--
-- 0001 deliberately stopped at the platform layer, on the assumption that
-- Stalwart would own mailboxes and messages in its own schema. The application
-- now stores and queries mail directly, so the production target needs these
-- tables too — `schema-parity.spec.mjs` caught the gap the moment the SQLite
-- development schema gained them.
--
-- When Stalwart is wired as the engine, these become the platform's index over
-- its store rather than the store of record. The columns are the ones the UI
-- reads; the bodies can move behind a blob reference without touching them.

BEGIN;

CREATE TABLE mailboxes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  -- JMAP role, or NULL for a user-created folder. The UI keys system folders
  -- off this and never off `name`, so a localised deployment still works.
  role            TEXT CHECK (role IN ('inbox','sent','drafts','archive','trash','junk','important')),
  parent_id       UUID REFERENCES mailboxes(id) ON DELETE CASCADE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, parent_id)
);
CREATE INDEX mailboxes_user_idx ON mailboxes(user_id);
-- One mailbox per role per user. Two inboxes is corruption, not a preference.
CREATE UNIQUE INDEX mailboxes_role_uniq ON mailboxes(user_id, role) WHERE role IS NOT NULL;

CREATE TABLE threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Normalised subject, a LAST resort when References/In-Reply-To are absent.
  -- Subject alone never groups messages.
  subject_key     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX threads_user_idx ON threads(user_id, updated_at DESC);
CREATE TRIGGER threads_updated_at BEFORE UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id       UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  mailbox_id      UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  message_id      TEXT,
  in_reply_to     TEXT,
  references_list TEXT,
  from_name       TEXT,
  from_email      TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  preview         TEXT NOT NULL DEFAULT '',
  body_text       TEXT,
  body_html       TEXT,
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  is_flagged      BOOLEAN NOT NULL DEFAULT false,
  is_draft        BOOLEAN NOT NULL DEFAULT false,
  is_answered     BOOLEAN NOT NULL DEFAULT false,
  has_attachment  BOOLEAN NOT NULL DEFAULT false,
  -- Authentication-Results as RECEIVED. Never recomputed by a client, and the
  -- verdict shown in the UI is derived from these on the server.
  spf_result      TEXT NOT NULL DEFAULT 'none',
  dkim_result     TEXT NOT NULL DEFAULT 'none',
  dmarc_result    TEXT NOT NULL DEFAULT 'none',
  arc_result      TEXT,
  tls_version     TEXT,
  display_name_spoof BOOLEAN NOT NULL DEFAULT false,
  idn_homograph   BOOLEAN NOT NULL DEFAULT false,
  snoozed_until   TIMESTAMPTZ,
  scheduled_at    TIMESTAMPTZ,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A message delivered twice is stored once.
  UNIQUE (user_id, message_id)
);

-- The list query, in the order the list actually asks for it.
CREATE INDEX messages_mailbox_idx ON messages(user_id, mailbox_id, received_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX messages_thread_idx ON messages(thread_id, received_at);
-- Partial indexes: the unread and flagged sets are a small fraction of a large
-- mailbox, so indexing only those rows keeps the index small enough to stay
-- cached at a million messages.
CREATE INDEX messages_unread_idx ON messages(user_id, mailbox_id)
  WHERE is_read = false AND deleted_at IS NULL;
CREATE INDEX messages_flagged_idx ON messages(user_id) WHERE is_flagged AND deleted_at IS NULL;

-- Full-text search. GIN over a generated tsvector, so the index is maintained
-- by the database rather than by application code that can forget.
ALTER TABLE messages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(from_email, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(from_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_text, '')), 'C')
  ) STORED;
CREATE INDEX messages_search_idx ON messages USING GIN (search_vector);

CREATE TABLE message_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('to', 'cc', 'bcc', 'reply-to')),
  name            TEXT,
  email           TEXT NOT NULL,
  position        INT NOT NULL DEFAULT 0
);
CREATE INDEX recipients_message_idx ON message_recipients(message_id);
CREATE INDEX recipients_email_idx ON message_recipients(email);

CREATE TABLE attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL while the upload belongs to an unsent draft.
  message_id      UUID REFERENCES messages(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  -- The type the SERVER determined from the file's magic bytes. `declared_type`
  -- is what the browser claimed, kept only so a mismatch can be surfaced.
  content_type    TEXT NOT NULL,
  declared_type   TEXT,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum        TEXT NOT NULL,
  storage_key     TEXT NOT NULL,
  is_inline       BOOLEAN NOT NULL DEFAULT false,
  content_id      TEXT,
  scan_status     TEXT NOT NULL DEFAULT 'pending'
                    CHECK (scan_status IN ('pending','clean','infected','skipped','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message_idx ON attachments(message_id);
CREATE INDEX attachments_user_idx ON attachments(user_id);
-- Content-addressed: the same file attached by one user many times is one
-- object in storage.
CREATE INDEX attachments_checksum_idx ON attachments(user_id, checksum);

CREATE TABLE labels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT 'gray',
  is_hidden       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE message_labels (
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  label_id        UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, label_id)
);
CREATE INDEX message_labels_label_idx ON message_labels(label_id);

COMMIT;
