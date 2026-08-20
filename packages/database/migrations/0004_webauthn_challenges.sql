-- 0004_webauthn_challenges.sql
--
-- WebAuthn challenge storage.
--
-- A challenge is the server's proof that a registration or authentication is
-- fresh. The authenticator signs it, and the server checks that what came back
-- is the value IT issued, once, recently. Without server-side storage there is
-- nothing to compare against and a captured assertion can be replayed forever.
--
-- Deliberately its own table rather than a column on `users`: a challenge is
-- also needed for a signed-OUT user authenticating with a passkey, and it must
-- be deletable the instant it is consumed without touching the account row.

BEGIN;

CREATE TABLE webauthn_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null for an authentication challenge issued before we know who is signing
  -- in. Set for registration, which always happens inside a session.
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  challenge       TEXT NOT NULL UNIQUE,
  purpose         TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  -- Short. A challenge that lives for an hour is an hour-long replay window;
  -- the ceremony itself takes seconds.
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at);
CREATE INDEX webauthn_challenges_user_idx ON webauthn_challenges(user_id);

-- `passkeys` already exists from the initial schema, but two columns are
-- missing for a real implementation.
--
-- `backed_up` and `device_type` come from the authenticator's own flags. A
-- multi-device (synced) passkey lives in a keychain and survives losing the
-- device; a single-device one does not. Telling those apart is what lets the
-- UI warn someone that their only passkey disappears with their laptop.
ALTER TABLE passkeys ADD COLUMN backed_up BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE passkeys ADD COLUMN device_type TEXT NOT NULL DEFAULT 'singleDevice'
  CHECK (device_type IN ('singleDevice', 'multiDevice'));

COMMIT;
