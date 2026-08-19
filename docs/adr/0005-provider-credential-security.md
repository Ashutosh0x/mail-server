# ADR-0005 — Provider credential security

**Status:** Accepted, 2026-08-20. Implemented in `apps/web/lib/server/secrets.ts`.

## Context

Federation means holding other people's keys. OAuth refresh tokens, S3 secret
access keys, SSH private keys and WebDAV passwords all end up in one column of
`storage_connections`. A refresh token is a long-lived bearer credential to a
customer's entire Drive; a database dump containing them in plaintext is a
breach of every connected account at once, not just of our system.

Three threats shape the design:

1. **Dump disclosure.** An attacker reads the table — via backup, replica, log,
   or SQL injection — and walks away with working credentials.
2. **Row swap.** An attacker who can write the table copies tenant A's
   ciphertext into tenant B's connection row, and B's mount now reads A's Drive.
   Encryption alone does not stop this; the ciphertext is still valid.
3. **Oracle.** An endpoint that distinguishes "wrong key" from "tampered" from
   "wrong context" tells an attacker which knob to turn next.

## Decision

**AES-256-GCM envelope encryption, with the connection row id as additional
authenticated data.**

```
stored form:  v1.<iv>.<tag>.<ciphertext>        all base64url

key:          SHA-256(SECRETS_KEY), 32 bytes, from the environment
nonce:        12 bytes, fresh per call
AAD:          "connection:<row id>"
```

Answering the threats in order:

1. **Dump disclosure** — the column holds ciphertext; the key is in the
   environment, not the database. A dump is not a credential set.
2. **Row swap** — the AAD binds each ciphertext to its row. Moving a blob to a
   different connection breaks the authentication tag and decryption fails.
   This is the property that makes the swap attack non-viable:

   ```
   credential sealed in row A  →  attempted open in row B  →  FAIL
   ```

3. **Oracle** — every failure mode returns one identical message, "Stored
   credential could not be decrypted." A test asserts that the wrong-key and
   wrong-context messages are byte-identical.

Supporting decisions:

- **GCM, not CBC.** Authenticated: a tampered row fails rather than yielding
  attacker-influenced plaintext. A test flips one bit of ciphertext and expects
  failure; another replaces the tag with zeros.
- **Fresh nonce per call.** Two rows holding the same credential must not
  produce the same ciphertext — identical blobs would leak that fact. A test
  seals the same input twice and asserts the outputs differ.
- **Versioned prefix (`v1.`).** An algorithm change can decrypt old rows rather
  than orphaning them.
- **`deriveKey` refuses material under 32 characters.** It does not stretch a
  weak secret and present the result as strong; it fails at startup and tells
  the operator to run `openssl rand -base64 32`. SHA-256 rather than a salted
  KDF is deliberate: the input is expected to be high-entropy already, and a
  per-record salt would have to be stored next to the ciphertext anyway.
- **`safeEqual`** is constant-time, for webhook signatures and API keys, and
  returns `false` on a length mismatch rather than throwing.
- **`redact`** shows the first and last four characters only — enough to
  identify which key is configured, never enough to use it.

### Rules that hold everywhere

- Credentials are **absent** from API responses, not redacted.
  `GET /api/storage/connections` selects explicit columns and
  `encrypted_credentials` is not among them.
- Never log a refresh token, access token, S3 secret, private key or password —
  not at any level, not in an error path.
- Never expose a provider secret to frontend JavaScript. The browser never holds
  a provider credential; it holds a session cookie against our own API.
- Never store a raw provider secret.

## Alternatives considered

**A KMS or HSM (AWS KMS, Vault transit).** Better key custody, and the right
answer for a large deployment — an envelope scheme with a per-row data key
wrapped by KMS is a natural upgrade. Deferred because it makes local development
require cloud credentials, and the version prefix leaves the upgrade path open.

**Application-level encryption without AAD.** Rejected: solves threat 1, leaves
threat 2 wide open.

**Database-native encryption (pgcrypto, TDE).** Rejected as sufficient on its
own. TDE protects the disk, not a `SELECT`. The threat here is an authenticated
read, not a stolen drive.

**Storing OAuth tokens in the session.** Rejected. Refresh tokens outlive
sessions, and it puts a provider credential one XSS away from the browser.

## Security implications

Concentrates risk in `SECRETS_KEY`. If it leaks, every stored credential is
exposed; if it is lost, every connection must be re-authorised. Consequences:
it must differ per environment, never be committed, and rotation needs a
re-encryption path — which the `v1.` prefix permits but which is **not yet
built**. That gap is real and is recorded in the roadmap.

Compromise of the running application still yields plaintext credentials,
because the process must decrypt to use them. This design defends the data at
rest and against row manipulation, not against code execution as the app.

## Performance implications

`NOT MEASURED`. AES-GCM on hardware AES is not expected to be a factor beside a
network round trip to a provider, but no figure is claimed.

## Migration implications

`storage_connections.encrypted_credentials` is nullable and new in migration
`0003`. No existing data to convert.

## Status

Implemented and covered by 16 tests in `apps/web/lib/server/secrets.spec.ts`.
Key rotation: **`PLANNED`**, not built.
