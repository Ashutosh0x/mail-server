# API reference

Fourteen route handlers under `apps/web/app/api`. These *are* the API today —
the Rust/Axum gateway in the blueprints is `PLANNED`, not built.

Every route is `runtime = "nodejs"`, `dynamic = "force-dynamic"`, and wrapped in
`guard()` so an unexpected throw becomes a 500 with a stable shape rather than a
stack trace. Every authenticated route calls `requireUser()` first.

## Conventions

**Auth** is a session cookie. `requireUser()` returns `401` when it is missing
or invalid; no route implements its own check.

**Errors** are uniform:

```json
{ "error": { "code": "invalid_action", "message": "Action must be one of: read, unread, …" } }
```

`code` is stable and safe to branch on; `message` is for humans and may change.

**Scoping** is not optional. Every data function takes `userId`, so a query
cannot accidentally run unscoped.

## Auth

| Route | Method | Notes |
|---|---|---|
| `/api/auth/register` | `POST` | `{ email, password, displayName }`. Password checked by length, not composition. Creates the account, its mailboxes and a session |
| `/api/auth/login` | `POST` | `{ email, password }`. Rate-limited per address. Returns one message for both "no such user" and "wrong password" |
| `/api/auth/logout` | `POST` | Invalidates the session server-side, not just the cookie |
| `/api/auth/session` | `GET` | Current user, or `401` |

## Configuration

| Route | Method | Notes |
|---|---|---|
| `/api/config` | `GET` | The limits the client needs |

Returns only `publicConfig()` — no hostnames, no credentials. Includes
`outboundConfigured`, so the composer can disable Send **with a reason** instead
of failing after the user has written a message.

The server enforces every one of these limits again regardless of what the
client does. A client-side limit is a hint, never a control.

## Mail

| Route | Method | Notes |
|---|---|---|
| `/api/mail` | `GET` | Threads for the caller. Cursor-paginated |
| `/api/mail/[threadId]` | `GET` | One thread with its messages. `404` if not the caller's |
| `/api/mail/actions` | `POST` | `{ action, ids }`, bulk |
| `/api/mailboxes` | `GET` | Mailboxes with live counts |
| `/api/labels` | `GET` `POST` | List and create |

**Pagination is keyset, not `OFFSET`** — on `(received_at, id)`. `OFFSET`
degrades linearly and, worse, skips or repeats rows when the underlying set
changes between pages, which for a mailbox means a message silently missing from
a scroll.

`limit` is clamped server-side. A client asking for a million rows gets
`maxPageSize`.

**Search** accepts the full grammar (see [search.md](search.md)) on `?q=`. It is
parsed once by the shared parser and translated to **bound parameters** — no
string interpolation reaches SQL.

`actions` are `read` · `unread` · `star` · `unstar` · `archive` · `trash` ·
`restore` · `spam` · `delete`, at most 500 ids per call, applied in one
transaction. Bulk by design: archiving fifty messages should be one round trip,
and partial application on failure is not a state worth having.

**Counts are computed per request**, not cached. An unread count of `0` means
zero, not stale.

## Attachments

| Route | Method | Notes |
|---|---|---|
| `/api/attachments/upload` | `POST` | **The body is the file.** Filename and declared type arrive as headers |
| `/api/attachments/[id]` | `GET` `DELETE` | Stream back, or remove |

The body-is-the-file shape avoids buffering a multipart envelope for something
that can be 100 MB. The stream is capped **mid-flight**, so an oversized upload
is aborted rather than measured after it has landed.

Type comes from **magic bytes**. The declared `Content-Type` is stored as a
claim and never trusted. HTML and SVG are never served inline.

Ownership is part of the lookup, so a changed id returns `404` — not `403`,
which would confirm the object exists.

## Storage federation

| Route | Method | Notes |
|---|---|---|
| `/api/storage/providers` | `GET` | The registry as the UI should render it |
| `/api/storage/connections` | `GET` `POST` | List; create |

`GET /providers` returns each provider's `status` and, for `planned` ones, the
`note` explaining why. `connectable` is currently `[]`. The client renders
planned providers as unavailable rather than as a connect button that fails
after an OAuth round trip.

`GET /connections` selects explicit columns; `encrypted_credentials` is not
among them. Credentials are **absent** from the response shape, not redacted.

`POST /connections` returns **`501 connector_not_implemented`** for every
provider, because none has a connector. This is the endpoint that would
otherwise become the fake connection — accepting credentials, writing a row, and
reporting "Connected" for something that can never list a file.

## Not built

No route sends mail. No route receives mail. No route creates a storage
connection that works. Compose, HTML rendering, admin, calendar and contacts
have no endpoints at all — not stubs returning empty data, but no routes.
