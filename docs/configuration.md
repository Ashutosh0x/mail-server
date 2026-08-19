# Configuration

Every value is read by the **server**. None is baked into the browser bundle.
The client learns limits from `GET /api/config`, and the server enforces every
one of them again on each request — a client-side limit is a hint, never a
control.

Copy `.env.example` to `.env`. Nothing is required for local development.

## Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Postgres, production target |
| `DATABASE_FILE` | `.data/mailserver.db` | SQLite, development |

## Secrets

| Variable | Default | Notes |
|---|---|---|
| `SECRETS_KEY` | — | **Minimum 32 characters.** Generate with `openssl rand -base64 32` |

Required once storage federation is used. Shorter values are refused at startup
rather than stretched and presented as strong. Must differ per environment and
must never be committed. Key rotation is **not built** — see
[ADR-0005](adr/0005-provider-credential-security.md).

## Limits

All enforced server-side. The frontend hardcodes none of them.

| Variable | Default | Why this number |
|---|---|---|
| `MAX_ATTACHMENT_SIZE_BYTES` | 100 MB | Storage is cheap. The binding constraint is what the *receiving* server accepts, not what we can store — so a token 5 MB cap would be arbitrary |
| `MAX_TOTAL_MESSAGE_SIZE_BYTES` | 150 MB | Whole message including every part, before transfer encoding |
| `MAX_OUTBOUND_MESSAGE_SIZE_BYTES` | 18 MB | Base64 inflates by ~37%, so 18 MB here is ~25 MB on the wire — under the common receiver cap |
| `MAX_USER_STORAGE_BYTES` | 15 GB | Per-user quota |
| `UPLOAD_CHUNK_SIZE_BYTES` | 8 MB | Resumable upload chunk. Large files are never buffered whole |
| `MAX_RECIPIENTS_PER_MESSAGE` | 100 | Anti-spam ceiling, not a UI limit |
| `MAX_PAGE_SIZE` | 100 | Clamp for list endpoints |
| `DEFAULT_PAGE_SIZE` | 50 | |
| `SESSION_TTL_SECONDS` | 2592000 (30d) | |

A non-numeric or non-positive value **throws at startup** rather than silently
falling back to a default — a typo in a limit should stop the server, not
quietly relax the limit.

## Mail transport

| Variable | Default | Notes |
|---|---|---|
| `SMTP_HOST` | unset | **Unset disables sending**, with a reason shown in the UI |
| `SMTP_PORT` | 587 | |
| `SMTP_USER` `SMTP_PASSWORD` `SMTP_FROM` | unset | |
| `IMAP_HOST` | unset | |
| `STALWART_API_URL` | `http://localhost:8080` | |
| `STALWART_API_TOKEN` | unset | |

Nothing consumes these yet — no transport client exists. `outboundConfigured`
in `GET /api/config` reflects `SMTP_HOST` so the composer can disable Send up
front rather than failing after a message is written. **Sending is never faked.**

## Object storage

| Variable | Default | Notes |
|---|---|---|
| `OBJECT_STORAGE_DRIVER` | `filesystem` | The only implemented driver |
| `OBJECT_STORAGE_ROOT` | `.data/blobs` | |
| `OBJECT_STORAGE_ENDPOINT` `_BUCKET` `_ACCESS_KEY` `_SECRET_KEY` | unset | For a future S3 driver |

Setting the driver to anything other than `filesystem` fails at startup rather
than silently writing to local disk while appearing to use object storage.

## Cache, anti-spam, observability

| Variable | Default | Status |
|---|---|---|
| `VALKEY_URL` | `redis://localhost:6379` | Not consumed yet |
| `RSPAMD_URL` | `http://localhost:11334` | Not consumed yet |
| `RSPAMD_PASSWORD` | unset | Not consumed yet |
| `CLAMAV_HOST` | unset | Not consumed yet |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Not consumed yet |

These are declared because `docker-compose.yml` starts the services, not because
code reads them. Listed as unconsumed rather than omitted, so the gap is visible.

## What is public

`publicConfig()` in `lib/server/config.ts` defines exactly what reaches the
browser: the size limits, the page sizes, and `outboundConfigured`. No
hostnames, no credentials, no driver names.
