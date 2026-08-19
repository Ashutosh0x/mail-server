-- 0001_platform_schema.sql
--
-- The PLATFORM schema: tenants, domains, users, delivery tracking, security and
-- API surface. Stalwart owns the mail store itself (mailboxes, messages,
-- threads, blobs) in its own schema — nothing here duplicates it, because two
-- systems writing overlapping copies of a mailbox is a reconciliation job
-- nobody wants to own.
--
-- Supersedes the scaffold's 001_initial_schema.sql. See docs/adr/0001.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Common updated_at trigger.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════
-- Tenancy
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  plan            TEXT NOT NULL DEFAULT 'free',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
  settings        JSONB NOT NULL DEFAULT '{}',
  max_domains     INT NOT NULL DEFAULT 10 CHECK (max_domains >= 0),
  max_users       INT NOT NULL DEFAULT 100 CHECK (max_users >= 0),
  max_storage_mb  BIGINT NOT NULL DEFAULT 10240 CHECK (max_storage_mb >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE tenants IS 'Isolated units of ownership. Every other table reaches a tenant.';

CREATE TABLE domains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified', 'active', 'suspended')),
  -- Per-record verification, not one boolean. The DNS wizard has to tell the
  -- operator WHICH record is missing; "not verified" is not an instruction.
  mx_verified     BOOLEAN NOT NULL DEFAULT false,
  spf_verified    BOOLEAN NOT NULL DEFAULT false,
  dkim_verified   BOOLEAN NOT NULL DEFAULT false,
  dmarc_verified  BOOLEAN NOT NULL DEFAULT false,
  mta_sts_enabled BOOLEAN NOT NULL DEFAULT false,
  tls_rpt_enabled BOOLEAN NOT NULL DEFAULT false,
  dkim_selector   TEXT,
  dkim_public_key TEXT,
  -- Encrypted with the platform master key before it ever reaches this column.
  -- A private key in a readable column is a finding, not a schema.
  dkim_private_key_enc BYTEA,
  catch_all_address TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX domains_tenant_idx ON domains(tenant_id);
CREATE TRIGGER domains_updated_at BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- Users and authentication
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  -- Argon2id, encoded PHC string. Nullable: a passkey-only account has no
  -- password, and storing a dummy hash to avoid a NULL invites someone to
  -- try to verify against it.
  password_hash   TEXT,
  role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('super_admin', 'org_admin', 'domain_admin', 'user', 'auditor')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
  quota_mb        BIGINT NOT NULL DEFAULT 1024 CHECK (quota_mb >= 0),
  used_storage_mb BIGINT NOT NULL DEFAULT 0 CHECK (used_storage_mb >= 0),
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  language        TEXT NOT NULL DEFAULT 'en',
  settings        JSONB NOT NULL DEFAULT '{}',
  mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
  mfa_secret_enc  BYTEA,
  recovery_codes_enc BYTEA,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_idx ON users(tenant_id);
CREATE INDEX users_domain_idx ON users(domain_id);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE passkeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- BYTEA, not TEXT: a WebAuthn credential id is binary, and base64 in a
  -- UNIQUE column makes two encodings of one credential look like two.
  credential_id   BYTEA NOT NULL UNIQUE,
  public_key      BYTEA NOT NULL,
  name            TEXT NOT NULL,
  sign_count      BIGINT NOT NULL DEFAULT 0,
  transports      TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);
CREATE INDEX passkeys_user_idx ON passkeys(user_id);

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The hash only. A readable session table is a table of live credentials.
  token_hash      TEXT NOT NULL UNIQUE,
  ip_address      INET,
  user_agent      TEXT,
  device_name     TEXT,
  is_trusted      BOOLEAN NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

-- ══════════════════════════════════════════════════════════════════════════
-- Addressing
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE aliases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  source_address  TEXT NOT NULL UNIQUE,
  -- An array, because one alias fanning out to several people is the common
  -- case, not the exception.
  destination     TEXT[] NOT NULL CHECK (cardinality(destination) > 0),
  alias_type      TEXT NOT NULL DEFAULT 'standard'
                    CHECK (alias_type IN ('standard', 'plus', 'catchall')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX aliases_domain_idx ON aliases(domain_id);

CREATE TABLE distribution_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id       UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  address         TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  members         TEXT[] NOT NULL DEFAULT '{}',
  allow_external  BOOLEAN NOT NULL DEFAULT false,
  moderated       BOOLEAN NOT NULL DEFAULT false,
  moderators      TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER dl_updated_at BEFORE UPDATE ON distribution_lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- Per-user mail preferences
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE mail_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  priority        INT NOT NULL DEFAULT 0,
  conditions      JSONB NOT NULL,
  actions         JSONB NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  -- The compiled Sieve is what Stalwart actually runs; the JSON above is what
  -- the rule builder edits. Keeping both means the UI never has to parse Sieve.
  sieve_script    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mail_rules_user_idx ON mail_rules(user_id, priority DESC);
CREATE TRIGGER mail_rules_updated_at BEFORE UPDATE ON mail_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE signatures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  html_content    TEXT NOT NULL,
  text_content    TEXT NOT NULL,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one default per user, enforced by the database rather than by
-- whichever code path happens to write last.
CREATE UNIQUE INDEX signatures_one_default_per_user
  ON signatures(user_id) WHERE is_default;

CREATE TABLE vacation_responders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  html_body       TEXT NOT NULL,
  text_body       TEXT NOT NULL,
  start_date      DATE,
  end_date        DATE,
  enabled         BOOLEAN NOT NULL DEFAULT false,
  exclude_contacts BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- ══════════════════════════════════════════════════════════════════════════
-- Delivery tracking (partitioned)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE delivery_events (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  message_id      TEXT,
  sender          TEXT NOT NULL,
  recipient       TEXT NOT NULL,
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('sent','delivered','bounced','deferred','rejected','spam_complaint')),
  smtp_code       INT,
  smtp_response   TEXT,
  remote_mx       TEXT,
  tls_version     TEXT,
  spf_result      TEXT,
  dkim_result     TEXT,
  dmarc_result    TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX delivery_events_tenant_idx ON delivery_events(tenant_id, created_at DESC);
CREATE INDEX delivery_events_message_idx ON delivery_events(message_id);

CREATE TABLE audit_logs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID,
  actor_id        UUID,
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     UUID,
  ip_address      INET,
  user_agent      TEXT,
  details         JSONB NOT NULL DEFAULT '{}',
  severity        TEXT NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info', 'warning', 'critical')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_logs_tenant_idx ON audit_logs(tenant_id, created_at DESC);

-- No foreign keys on the partitioned tables: an audit row must outlive the
-- tenant it describes. Deleting a tenant and losing the record of who deleted
-- it defeats the point of an audit log.

/*
 * Partition maintenance.
 *
 * Declaring PARTITION BY and then creating a single DEFAULT partition — as the
 * scaffold did — puts every row in one table and buys nothing. Creating one
 * month and stopping, as the plan did, starts rejecting writes on the 1st.
 *
 * So: a function to mint a month, plus a DEFAULT catch-all so a row outside
 * every declared range is stored rather than refused. Losing a delivery record
 * because a cron job did not run is worse than a slightly slow query.
 */
CREATE OR REPLACE FUNCTION create_month_partition(base_table TEXT, month DATE)
RETURNS TEXT AS $$
DECLARE
  start_at DATE := date_trunc('month', month)::DATE;
  end_at   DATE := (date_trunc('month', month) + INTERVAL '1 month')::DATE;
  part     TEXT := format('%s_%s', base_table, to_char(start_at, 'YYYY_MM'));
BEGIN
  IF to_regclass(part) IS NOT NULL THEN
    RETURN part;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    part, base_table, start_at, end_at
  );
  RETURN part;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_month_partition IS
  'Idempotent. Call for the current and next month from a scheduled job.';

-- This month and next, so a fresh install works and survives the month rolling
-- over before the scheduler is configured.
SELECT create_month_partition('delivery_events', CURRENT_DATE);
SELECT create_month_partition('delivery_events', (CURRENT_DATE + INTERVAL '1 month')::DATE);
SELECT create_month_partition('audit_logs', CURRENT_DATE);
SELECT create_month_partition('audit_logs', (CURRENT_DATE + INTERVAL '1 month')::DATE);

CREATE TABLE delivery_events_default PARTITION OF delivery_events DEFAULT;
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- ══════════════════════════════════════════════════════════════════════════
-- Security
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE security_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,
  event_type      TEXT NOT NULL,
  source_ip       INET,
  target_user     TEXT,
  details         JSONB NOT NULL DEFAULT '{}',
  severity        TEXT NOT NULL DEFAULT 'warning'
                    CHECK (severity IN ('info', 'warning', 'critical')),
  resolved        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX security_events_unresolved_idx
  ON security_events(tenant_id, created_at DESC) WHERE NOT resolved;

CREATE TABLE blocked_ips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address      INET NOT NULL UNIQUE,
  reason          TEXT NOT NULL,
  blocked_until   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The SMTP path checks this on every connection, so the lookup is the hot one.
CREATE INDEX blocked_ips_active_idx ON blocked_ips(ip_address)
  WHERE blocked_until IS NULL OR blocked_until > now();

-- ══════════════════════════════════════════════════════════════════════════
-- API surface
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  -- Shown in the UI so a key can be identified without revealing it.
  key_prefix      TEXT NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  rate_limit      INT NOT NULL DEFAULT 1000 CHECK (rate_limit > 0),
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_idx ON api_keys(tenant_id);

CREATE TABLE webhooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  events          TEXT[] NOT NULL CHECK (cardinality(events) > 0),
  -- HMAC signing secret. Receivers verify every delivery against it.
  secret_enc      BYTEA NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  failure_count   INT NOT NULL DEFAULT 0,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_tenant_idx ON webhooks(tenant_id);
CREATE TRIGGER webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
