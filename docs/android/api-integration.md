# Android ↔ Mail Server API integration

Every contract below was read out of the shipped server code, not inferred from
a name. Each section cites the file it came from, so a reader can check it and a
future change can be traced to the thing that must change with it.

Read this before writing Android code. Where the server does not currently
support something, it says so under **Backend required** rather than proposing
an Android-side substitute.

---

## 1. The one fact that shapes the whole client

**Authentication is an httpOnly cookie. There is no bearer-token path.**

`currentUser()` in `apps/web/lib/server/auth.ts` resolves the caller by reading
exactly one thing:

```ts
const token = (await cookies()).get(SESSION_COOKIE)?.value;
```

No `Authorization` header is read anywhere in the codebase. Every authenticated
route funnels through `requireUser()` → `currentUser()`, so this is the only
way in.

| Property | Value | Source |
| --- | --- | --- |
| Cookie name | `mf_session` | `auth.ts` `SESSION_COOKIE` |
| Value | 32 random bytes, base64url | `createSession()` |
| Stored as | SHA-256 hash, never plaintext | `hashToken()` |
| `httpOnly` | `true` | `setSessionCookie()` |
| `secure` | `config.isProduction` | `setSessionCookie()` |
| `sameSite` | `lax` | `setSessionCookie()` |
| `path` | `/` | `setSessionCookie()` |
| Lifetime | `SESSION_TTL_SECONDS`, default **30 days** | `config.ts` |

### What this means for Android — and what it does not

This is **not** a blocker, and it does **not** justify adding an Android-only
token endpoint.

- `httpOnly` is a browser-scripting protection. It is meaningless to a native
  client, which is not a browser and has no DOM to defend.
- `sameSite=lax` is a browser cross-origin protection. OkHttp is not a browser
  and does not apply it.

So Android authenticates by holding the cookie: a persistent OkHttp `CookieJar`
that stores `mf_session` in Keystore-backed encrypted storage and replays it on
every request. That reuses the existing session model exactly as instructed,
with no server change and no second auth system.

Two consequences to design around:

1. **The token is bearer-equivalent once extracted.** It must never touch
   `SharedPreferences` unencrypted, never be logged, and never appear in a
   crash report.
2. **`secure: config.isProduction`** means the cookie is only sent over HTTPS in
   production. A production build talking to plain HTTP will silently fail to
   authenticate. See `setup.md` for the local-development story.

---

## 2. Response envelope

From `apps/web/lib/server/http.ts`.

**Success** is the bare payload — there is no `{ data: … }` wrapper:

```json
{ "threads": [ … ], "nextCursor": "…" }
```

**Failure** is always this shape, on every endpoint:

```json
{ "error": { "code": "unauthenticated", "message": "Sign in to continue.", "requestId": "uuid" } }
```

`message` is written for a human and is safe to show. `code` is what the client
branches on. `requestId` should be attached to any bug report and never shown
prominently.

The comment in `http.ts` is explicit about why this is uniform: *"A client that
has to guess the shape per endpoint ends up with a `catch` that shows
'Something went wrong' for everything."* The Android error mapper must honour
that — decode `code`, not the HTTP status alone.

### Codes verified in the source

| Status | `code` | Meaning for the client |
| --- | --- | --- |
| 400 | `invalid_body` | Request was not JSON |
| 400 | `invalid_credentials` | Missing/malformed email or password |
| 401 | `unauthenticated` | No session — start re-authentication |
| 401 | `invalid_credentials` | Wrong email or password |
| 409 | *(draft conflict)* | Body carries `conflict: true` — see §6 |
| 429 | `too_many_attempts` | Address locked for 15 minutes |
| 500 | `internal_error` | Generic; `guard()` never leaks detail |

`guard()` wraps every route and converts an unexpected throw into
`internal_error`. Android must therefore never expect a stack trace, and must
not treat a 500 as retryable-forever.

---

## 3. Authentication endpoints

### `POST /api/auth/login`

```json
{ "email": "user@example.com", "password": "…" }
```

Returns `{ "user": { "id": "…", "email": "…" } }` and a `Set-Cookie` header.
**The body carries no token** — the cookie is the credential, so the client must
capture it from `Set-Cookie`.

Rate limiting is real and is keyed on the **address, not the IP** — the source
comment explains why: *"an attacker rotates IPs, and the account is what needs
protecting."* Ten failures in 15 minutes returns 429. Android must surface the
15-minute window rather than inviting the user to keep retrying.

Login failure is deliberately indistinguishable between "no such account" and
"wrong password". Android must not try to be more helpful than the server here;
doing so would reintroduce the account-enumeration hole the server closed.

### `GET /api/auth/session`

The session probe used at cold start. Returns `{ "user": null }` when there is
no valid session — a **200, not a 401**. Android must branch on `user == null`,
not on the status code.

When signed in it returns `id`, `email`, `displayName`, `role`, `quotaBytes`,
`usedBytes`.

### `POST /api/auth/logout`, `POST /api/auth/register`

### Passkeys — `POST /api/auth/passkey/challenge`, `POST /api/auth/passkey`

WebAuthn is implemented server-side. `config.ts` exposes `webauthnRpId`
(default `localhost`) and `webauthnOrigins` (default `http://localhost:3000`).

**Backend required for Android passkeys.** Android Credential Manager needs the
relying party to publish `/.well-known/assetlinks.json` binding the app's
signing-certificate SHA-256 to the RP ID, and the app's origin
(`android:apk-key-hash:…`) must be present in `WEBAUTHN_ORIGINS`. Neither
exists today. The client abstraction should be written so passkey sign-in slots
in once those are configured; until then the app must show password sign-in
only, not a passkey button that fails.

---

## 4. Mail

### `GET /api/mail` — thread list

From `apps/web/app/api/mail/route.ts` and `lib/server/mail.ts`.

| Query param | Notes |
| --- | --- |
| `mailboxId` | optional |
| `labelId` | optional |
| `q` | search text — see §8 |
| `cursor` | opaque, from `nextCursor` |
| `limit` | clamped server-side to `maxPageSize` |

Returns `ThreadPage`: `{ threads, nextCursor }`. `nextCursor` is `null` on the
last page — that, not an empty array, is the end-of-list signal.

**Cursor pagination is keyset, not offset.** The cursor is
`base64url("<receivedAt>|<id>")` compared as a tuple:

```sql
AND (m.received_at, m.id) < (?, ?)
```

The source note explains the reason: a position-based cursor does not skip or
duplicate rows when mail arrives mid-scroll. Android must therefore **never**
synthesise a cursor, and must not attempt offset paging by page number.

`limit` is clamped, so the server may return fewer than requested. Paging must
be driven by `nextCursor` alone.

### `GET /api/mail/{threadId}` — one conversation

Returns `{ thread, emails }`.

### `POST /api/mail/actions` — mailbox actions, including bulk

The action vocabulary is a closed union in `lib/server/mail.ts`:

```ts
export type MessageAction =
  "read" | "unread" | "star" | "unstar" |
  "archive" | "trash" | "restore" | "spam" | "delete";
```

Android must use exactly these nine strings. This is the endpoint for bulk
selection — one request carrying many message ids, not a loop of requests.

Mailbox-specific semantics (`trash` vs `delete`) are the server's to define.
Android reads them from here; it does not re-derive them. See
`docs/mail-actions.md`.

### `GET /api/mailboxes`, `GET /api/labels`

System mailboxes are provisioned by `provisionMailboxes()`. `Label` and
`LabelColor` are shared types — Android mirrors `LABEL_COLORS` rather than
inventing a palette.

---

## 5. Shared domain types

`packages/types/src/mail.ts` is the contract. The Kotlin models must mirror
these names exactly so a field rename in the package is a compile error on
Android rather than a silent null:

`EmailAddress`, `Mailbox`, `MailboxRole`, `Keyword`, `Attachment`,
`AuthResult`, `AuthenticationSummary`, `SecurityVerdict`, `EmailHeader`,
`EmailBody`, `Thread`, `LabelColor`, `Label`, `MailQuery`, `Page<T>`.

`SecurityVerdict` (`verified | unverified | suspicious | dangerous`) and
`AuthenticationSummary` are what §8 of the brief calls "message authentication
status" — they already exist and must be rendered, not recomputed on device.

---

## 6. Drafts and the conflict contract

From `apps/web/app/api/drafts/[id]/route.ts`.

`PATCH /api/drafts/{id}` accepts an optional numeric `version`. On success:

```json
{ "version": 4, "savedAt": "2026-08-21T…Z" }
```

On a version mismatch the server returns **409 with its own copy attached** —
the route comment says it is sent *"so the client can compare rather than"*
blindly overwrite:

```json
{ "conflict": true, "…": "server's current draft" }
```

Android must implement the resolution flow the brief asks for: show *"This
draft was changed somewhere else."*, present both versions, and let the user
choose. Auto-resolving by last-write-wins would defeat the mechanism the server
built.

`POST /api/drafts/{id}/send` is the send path. Compose must not post to a
separate send endpoint.

---

## 7. Attachments and limits

`GET /api/config` returns `publicConfig()` from `lib/server/config.ts`:

| Field | Default |
| --- | --- |
| `maxAttachmentBytes` | 100 MB |
| `maxMessageBytes`, `maxOutboundMessageBytes` | — |
| `maxUserStorageBytes` | — |
| `uploadChunkBytes` | — |
| `maxRecipients` | — |
| `maxPageSize` / `defaultPageSize` | 100 / 50 |
| `outboundConfigured` | `smtp.host !== null` |

**Android must read these and hardcode none of them**, per §13 of the brief.
`uploadChunkBytes` in particular is the server telling the client how to chunk;
inventing a chunk size would be a client deciding a server concern.

`outboundConfigured` is why Send can be disabled *with a reason* instead of
failing after the user writes a message. The Android composer must honour it.

Endpoints: `POST /api/attachments/upload`, `GET /api/attachments/{id}`.
Downloads are authenticated through the session cookie — there are no signed
public URLs, so §14's "do not expose direct unprotected storage URLs" is
already satisfied by the server design.

---

## 8. Search

`packages/types/src/search.ts` is a **pure, dependency-free parser shared by the
web client and the API**, precisely so the chips a user sees cannot disagree
with the results they get.

Seventeen fields are implemented:

```
from to cc bcc subject body filename label in is has
after before newer older larger smaller size
```

- `is:` — `unread read starred flagged important draft snoozed muted`
- `has:` — `attachment link image calendar`
- `-` negates; quotes make a phrase; `OR` within a group, `AND` between groups,
  so `a OR b c` means `(a OR b) AND c`.
- `unknownFields` is returned so the UI can *say* a field is not an operator
  rather than silently searching for the literal text.

### The one genuine architectural tension

The brief says "do not implement a second search parser". The parser is
TypeScript and cannot run on Android.

Two options, and only one is honest:

- **Send the raw query string to `GET /api/mail?q=…`** and let the server parse.
  The server stays authoritative, no second parser exists, and search works.
  This is what Phase 2 does.
- Port the parser to Kotlin — creates exactly the second implementation the
  contract package exists to prevent, and would drift.

**Backend required for filter chips.** To render chips on Android without a
second parser, the server needs to expose the parse result — either a
`POST /api/search/parse` returning `ParsedQuery`, or a `parsed` field alongside
search results. Both keep one parser authoritative and would benefit the web
client too (it currently parses locally, duplicating work the server repeats).
Until then, Android shows a plain query field with history, and no chips.

---

## 9. Storage

Routes: `/api/storage/providers`, `/api/storage/connections`,
`/api/storage/connections/{id}`, `/api/storage/connections/{id}/files`,
`/api/storage/connections/{id}/content`, `/api/storage/discover`,
`/api/account/storage`, `/api/account/storage/cleanup`.

Shared types in `packages/types/src/storage.ts` and `connector.ts`:
`StorageMode`, `ProviderId`, `Capability`, `StorageConnection`, `StorageMount`,
`MountRole`, `EffectiveAccess`, `StorageItem`, `ListPage`, `StorageConnector`.

The invariant recorded in the project notes holds here and Android must not
weaken it: `effectiveAccess()` = tenant ∧ mount ∧ provider, monotonic, and
`availableProviders()` returns `[]` rather than a guess.

Per §22, Android browses storage **through the Mail Server**, never directly to
a NAS on the same LAN, even when it could reach it.

---

## 10. Platform capabilities

`GET /api/system/capabilities` (authenticated — it is reconnaissance otherwise)
reports what the host can actually do. Every flag is derived from a real probe,
never from the platform name:

```
storage: { local, mounted, localConnections, webdav, smb, nfs, s3, networkDiscovery }
discovery: { adapter, mdns, ssdp, errors }
```

`smb: false` on Windows is correct and deliberate — the host can mount SMB, but
Mail Server has no SMB client. Android must render capability-gated UI from this
response, not from assumptions.

---

## 11. Notifications — **backend required, nothing exists**

A search across `apps/web/app`, `apps/web/lib` and `packages` for
`web-push`, `webpush`, `EventSource`, `WebSocket`, `text/event-stream`,
`firebase` and `fcm` returns **no matches**.

There is no push infrastructure, no server-sent events, no websocket, and no
device-token registration. Per §19 and §64, Android must **not** fabricate
notifications or poll aggressively to imitate them.

What Phase 5 delivers is the client abstraction plus this specification of the
server work required:

1. A device registration endpoint (`POST /api/devices`) storing an FCM token
   against the session/user, revoked with the session.
2. An event source for new mail — which depends on (3).
3. **Receiving mail is itself an open backend gap.** The repository already
   identifies IMAP/JMAP ingestion as unbuilt. Until mail can arrive, there is
   nothing to notify about. Android must consume real delivery events when they
   exist and must not invent an Inbox in the meantime.

Any such endpoint must serve the web client too (web push uses the same
registration shape), per §61.

---

## 12. Endpoint inventory

39 routes, all under `apps/web/app/api`:

```
auth/         login logout register session passkey passkey/challenge
account/      · profile preferences security storage storage/cleanup
              sessions sessions/{id} sessions/revoke-all
              passkeys passkeys/{id} passkeys/challenge
mail/         · {threadId} actions
mailboxes/    ·
labels/       ·
drafts/       · {id} {id}/send
outbound/     {id}
attachments/  upload {id}
recipients/   ·
storage/      providers connections connections/{id}
              connections/{id}/files connections/{id}/content discover
system/       capabilities
config/       ·
admin/        storage/health
```

---

## 13. Parity matrix

Honest status. Nothing is marked Built until it works end-to-end against a
running server.

| Feature | Backend | Web | Android |
| --- | --- | --- | --- |
| Password sign-in | Built | Built | Phase 1 |
| Session persist / expiry | Built | Built | Phase 1 |
| Sessions list / revoke | Built | Built | Phase 4 |
| Passkeys | Built | Built | **Backend required** (assetlinks + origins) |
| Mailbox list, paging | Built | Built | Phase 1 |
| Conversation view | Built | Built | Phase 2 |
| Actions / bulk | Built | Built | Phase 2 |
| Labels | Built | Built | Phase 2 |
| Search (raw query) | Built | Built | Phase 2 |
| Search filter chips | **Backend required** | Built (local parse) | Blocked on parse API |
| Compose / send | Built | Built | Phase 3 |
| Drafts + 409 conflict | Built | Built | Phase 3 |
| Attachments up/down | Built | Built | Phase 3 |
| Storage browser | Built | Built | Phase 4 |
| Security centre | Built | Built | Phase 4 |
| Notifications | **Not built** | Not built | **Backend required** |
| Receiving mail (IMAP/JMAP) | **Not built** | — | Blocked |
| Offline cache | n/a | n/a | Phase 5 |
| Voice dictation | n/a | Requested | Phase 6 |

---

## 14. Rules this client holds to

- The server is the source of truth for messages, mailbox state, labels,
  drafts, attachments, account, security and storage. Room is a cache, never a
  second authority.
- No mock mail, no fake counts, no simulated delivery, no invented storage
  figures. An empty account renders the server's real empty state.
- Authorization is never inferred on device. User id, tenant id, mailbox
  ownership and storage ownership are validated server-side on every call.
- No Android-only endpoint. Anything Android needs is added to the shared
  backend so the web client can use it too.
