<div align="center">

# Mail Server

**Self-hosted email that behaves like a product, not a server.**

[![Next.js](https://img.shields.io/badge/Next.js-16.3.1-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2.8-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.3.3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

[![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.4-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)](https://turbo.build)

[![Stalwart](https://img.shields.io/badge/Stalwart-v0.16.14-1B2A4A?style=for-the-badge&logo=maildotru&logoColor=white)](https://stalw.art)
[![Valkey](https://img.shields.io/badge/Valkey-9.1-FF4438?style=for-the-badge&logo=redis&logoColor=white)](https://valkey.io)
[![MinIO](https://img.shields.io/badge/MinIO-S3-C72E49?style=for-the-badge&logo=minio&logoColor=white)](https://min.io)
[![Rspamd](https://img.shields.io/badge/Rspamd-4.1-2E7D32?style=for-the-badge&logo=maildotcom&logoColor=white)](https://rspamd.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Vitest](https://img.shields.io/badge/Vitest-308_passing-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](#license)
[![Typecheck](https://img.shields.io/badge/typecheck-3%2F3-success?style=flat-square)](#verification)
[![Tests](https://img.shields.io/badge/tests-308_passing-success?style=flat-square)](#verification)
[![Benchmarks](https://img.shields.io/badge/benchmarks-NOT_MEASURED-lightgrey?style=flat-square)](docs/adr/0006-benchmark-methodology.md)

</div>

---

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/00d9470a-9087-41c0-baaa-b9f6a3c7f82a" />


[Stalwart](https://stalw.art) is the mail engine — SMTP, IMAP4rev2, JMAP,
CalDAV, CardDAV, WebDAV and Sieve in one binary. Mail Server is the platform
around it: the webmail client, the admin surface, the multi-tenant control plane
and the storage federation layer.

> ### Status: real backend, no mail transport
>
> Accounts, sessions, mailboxes, messages, labels, search and attachments are
> stored in a real database behind a real authenticated API. **There is no
> fixture data anywhere in the product path** — a new account's inbox is empty
> because it is empty.
>
> **Compose and send now work.** A draft becomes a real RFC 5322 message and is
> queued; with SMTP configured it is delivered and the UI reports `sent` only
> once a mail server has accepted it. Without SMTP it says `queued`, honestly.
> Drafts can be reopened from the Drafts mailbox with their recipients, body and
> attachments intact. Receiving mail (IMAP/JMAP) is still not built.
> Full picture in **[docs/architecture-status.md](docs/architecture-status.md)**,
> and a feature-by-feature composer audit in
> **[docs/COMPOSER-FINAL-AUDIT.md](docs/COMPOSER-FINAL-AUDIT.md)**.

## Quick start

Node 22+ is the entire requirement. The database is SQLite through
`node:sqlite`, so there is no Docker, no Postgres service and no native build.

```bash
npm install
npm test                                   # 308 tests across four packages
npm --workspace @mailserver/web run dev    # http://localhost:3000
```

Open http://localhost:3000 and create an account. The database file appears at
`apps/web/.data/mailserver.db` on first run.

## Architecture

The governing principle: **do not rebuild infrastructure the underlying platform
already provides correctly.**

```
  Stalwart      SMTP · IMAP4rev2 · JMAP · CalDAV · CardDAV · WebDAV · Sieve
      │         DKIM · DKIM2 · SPF · DMARC/DMARCbis · TLS · quotas · ACLs
      ▼
  Control plane          tenancy · policy · federation · audit · search
      │                  (Next.js route handlers today; Rust/Axum planned)
      ▼
  Product UI             one experience across surfaces that speak
                         different protocols underneath
```

That principle produced this project's largest correction. The original plan had
ground-up Calendar and Contacts subsystems; verification found Stalwart already
ships CalDAV with scheduling and CardDAV with sync-tokens, so both became
clients — and recurrence, iTIP/iMIP, free/busy and vCard parsing left the
roadmap entirely. See [ADR-0002](docs/adr/0002-calendar-architecture.md),
[ADR-0003](docs/adr/0003-contacts-architecture.md) and
[ADR-0007](docs/adr/0007-stalwart-as-infrastructure-authority.md).

## Repository layout

| Path | What it is | State |
|---|---|---|
| `packages/types` | Domain contract, search grammar, storage federation, connector contract | **built · 57 tests** |
| `packages/ui` | OKLCH design tokens, icon registry, motion and haptic systems | **built · 33 tests** |
| `packages/database` | Postgres migrations, SQLite dev schema, migration runner | **built · 10 tests** |
| `apps/web` | Webmail client, composer, security center, storage providers, 33 API routes | **built · 208 tests** |
| `benchmarks/` | Scenario definitions | **no results — nothing has been run** |
| `infrastructure/` | Compose, Stalwart and Rspamd config | scaffold, **never executed** |
| `services/api` | Rust/Axum gateway | not started |
| `apps/admin` | Admin dashboard | not started |

## Features

Status is evidence-based, not aspirational:

| | Meaning |
|---|---|
| **Built** | Works end to end, with a test or a browser run behind it |
| **Partial** | Real but incomplete. The gap is stated, not implied |
| **Backend only** | The server can do it; no interface reaches it |
| **Planned** | Absent from the UI as well as the backend. Nothing pretends otherwise |

### Composing and sending

| Feature | Status | Detail |
|---|---|---|
| Rich text editor | **Built** | Bold, italic, underline, strike, ordered/unordered lists, blockquote, code block, link, clear formatting, undo/redo. `contentEditable` + `execCommand`, no editor library — see [ADR-0008](docs/adr/) |
| Recipients | **Built** | To/Cc/Bcc chips. Commit on comma, semicolon, Enter, Tab or blur; paste a list; backspace to edit; case-insensitive de-dup |
| Recipient autocomplete | **Built** | `GET /api/recipients`, ranked by how often you have written to them. ARIA combobox, arrow-key navigation |
| Address validation | **Built** | One `isValidAddress` shared by client and server, so the composer cannot accept what send will reject |
| Attachments | **Built** | Drag-drop or picker, real XHR progress, cancel, retry, remove. Type from magic bytes |
| Draft autosave | **Built** | 800 ms debounce. The status shown is the server's response, never an optimistic guess |
| Draft concurrency | **Built** | `messages.version`; a second tab saving from a stale version gets 409 with the server's copy attached |
| Reopen a draft | **Built** | Click a draft to resume it — recipients, subject, body and attachments restored |
| Reply / Reply all | **Built** | Built server-side. Reply-all adds the other recipients and never this account |
| Forward | **Built** | `Fwd:`, quoted original, and deliberately **no** recipients — pre-filling them is how a thread leaks |
| Threading headers | **Built** | `In-Reply-To` and `References` derived from the stored row, not accepted from the request |
| Send | **Built** | Reports `sent` only after an SMTP server accepts. Says `queued` honestly when SMTP is unconfigured |
| Idempotent send | **Built** | `Idempotency-Key` against a `UNIQUE` column; a double-click cannot send twice |
| Retry after failure | **Built** | The draft survives and a Try again button re-sends under the same key |
| Empty-subject check | **Built** | Asked once, and only when the subject is genuinely empty |
| Sender identity | **Partial** | Authorised senders computed from `users` + `aliases` and validated server-side. The picker only appears when more than one exists, which is rare in practice |
| Inline images | **Backend only** | MIME emits `cid:` parts and the sanitiser permits them; no editor insertion path |
| Signatures | **Planned** | `signatures` table exists; nothing reads it |
| Scheduled send | **Planned** | `messages.scheduled_at` exists and is unused. No scheduler |
| Undo send | **Planned** | No delay window |
| Read receipts | **Planned** | No UI, no MDN headers |
| Templates, mail merge | **Planned** | — |

### Reading and organising

| Feature | Status | Detail |
|---|---|---|
| Thread list | **Built** | Keyset pagination on `(received_at, id)` — stable under inserts, unlike `OFFSET` |
| Conversation view | **Built** | Sender details, authentication chips, attachment list |
| System mailboxes | **Built** | Inbox, Sent, Drafts, Archive, Spam, Trash, with live unread and total counts |
| Custom labels | **Built** | CRUD via `/api/labels`, 12 OKLCH colours |
| Bulk actions | **Built** | Read, unread, star, archive, trash, spam, restore, permanent delete |
| Undo | **Built** | Only where a genuine inverse exists. Permanent delete offers none, because nothing restores it |
| Row density | **Built** | Compact, comfortable, spacious |
| Swipe to act | **Built** | Directional axis lock; destructive swipes need roughly twice the travel |
| HTML body rendering | **Partial** | Sanitisation is built and tested (22 tests) and every outbound body uses it. The read path still needs remote-image blocking, tracker stripping and a sandboxed frame, so the pane shows the plain-text preview until then |
| **Receiving mail** | **Planned** | **No IMAP/JMAP ingestion. The Inbox is empty because nothing can arrive — this is the project's blocking gap** |
| Custom folders | **Planned** | No create, rename or delete |
| Snooze, pin | **Planned** | No scheduler behind either |
| Mail rules / Sieve | **Planned** | `mail_rules` table exists; no API, no UI |
| Vacation responder | **Planned** | `vacation_responders` table exists; no API, no UI |

### Search

| Feature | Status | Detail |
|---|---|---|
| Full-text search | **Built** | SQLite FTS5 `MATCH`; `tsvector` in the Postgres schema |
| Query grammar | **Built** | 18 operators, parsed into terms with byte offsets so a filter chip knows what to remove |
| Text operators | **Built** | `from:` `to:` `cc:` `bcc:` `subject:` `body:` `filename:` `label:` `in:` |
| Enum operators | **Built** | `is:` (unread, read, starred, flagged, important, draft, snoozed, muted) · `has:` (attachment, link, image, calendar) |
| Date and size | **Built** | `after:` `before:` · `newer:` `older:` (`7d`) · `larger:` `smaller:` `size:` (`5mb`) |
| Negation, phrases, OR | **Built** | `-from:x`, `"exact phrase"`, `OR` with `AND` precedence. Parsing never throws — an unknown field degrades to free text |
| Search in attachments | **Planned** | No text extraction |
| Saved searches | **Planned** | — |

### Authentication and account

| Feature | Status | Detail |
|---|---|---|
| Password auth | **Built** | scrypt, N=2¹⁵, r=8, p=1 |
| Passkeys / WebAuthn | **Built** | Register, sign in, remove. Single-use challenges; sign-count clone detection. Verified against Chrome's virtual authenticator, which produces real signatures |
| Sessions | **Built** | 32-byte CSPRNG tokens, SHA-256 before storage. List, revoke one, revoke all others |
| Anti-enumeration | **Built** | Sign-in cannot be used to discover which addresses exist |
| Login throttling | **Built** | Locks the **address**, not the IP — an attacker rotates IPs; the account is what needs protecting |
| Account center | **Built** | Profile, Appearance, Security, Devices, Storage, Privacy, Notifications |
| Security posture | **Built** | Scored from real signals, with an audit-log timeline |
| Rate limiting elsewhere | **Planned** | Only sign-in is throttled today |
| TOTP, backup codes | **Planned** | Passkeys are the only second factor |
| OIDC / SAML / LDAP | **Planned** | — |

### Storage

| Feature | Status | Detail |
|---|---|---|
| Filesystem driver | **Built** | Atomic `.part` → rename, path-traversal prevention, real health probe |
| NFS driver | **Built** | Verifies the root is a real mount (`statfs` magic `0x6969`, device-id boundary check) — an unmounted export is still a valid empty directory, and writing into it loses data silently |
| Quota enforcement | **Built** | Counted during the upload stream, so an oversized file is aborted rather than measured after it lands |
| Credential sealing | **Built** | AES-256-GCM with the row id as AAD, so a ciphertext moved to another row fails to decrypt |
| Federation model | **Built (types)** | 14-provider registry, `effective = tenant ∧ mount ∧ provider`, 8-point promotion gate |
| S3 / cloud connectors | **Planned** | `availableProviders()` returns `[]` and `POST /api/storage/connections` returns `501` for every provider — a test fails the moment that changes without a real connector |
| Drive UI | **Planned** | — |

### Interface

| Feature | Status | Detail |
|---|---|---|
| Keyboard shortcuts | **Built** | `J`/`K`, `Enter`/`O`, `Esc`, `X`, `S`, `E`, `#`, `U`, `C`, `/`, `,`, `G`+`I/S/D/A/T/P`, and `R`/`A`/`F` while reading. The shortcuts dialog lists only what is wired |
| Dark mode | **Built** | OKLCH tokens, both themes defined for every colour |
| Motion system | **Built** | Durations, easings and spring constants in one place; FLIP for list reordering |
| Haptics | **Built** | Vibration API with capability detection and a 50 ms rate limit, so a continuous gesture fires once rather than per frame |
| Reduced motion | **Built** | OS preference and the account's own setting, combined once so they cannot disagree |
| Toasts with undo | **Built** | The countdown bar is the real window in which the inverse call still fires |
| Skeletons | **Built** | Match the exact row geometry, so nothing shifts on load |
| Responsive layout | **Built** | Sidebar collapses to a rail below 768 px |
| List virtualization | **Planned** | `@tanstack/react-virtual` is a declared dependency that **no file imports**. The list is not virtualized |
| PWA / offline | **Planned** | No service worker, no manifest |
| Desktop notifications | **Planned** | Preferences are stored but drive no delivery |

### Platform and operations

| Feature | Status | Detail |
|---|---|---|
| Dual-dialect database | **Built** | SQLite for development, PostgreSQL for production, held in step by a parity test |
| Migrations | **Built** | 5 migrations with SHA-256 drift detection; `--dry-run` works without `pg` installed |
| Partitioned tables | **Built** | `delivery_events` and `audit_logs`, monthly ranges |
| API | **Built** | 33 routes. Unversioned, and there is no OpenAPI document |
| Outbound queue | **Partial** | `outbound_queue` is a real durable state, but delivery runs inline in the request. No worker, so a failed send has no automatic retry |
| Stalwart, Rspamd, ClamAV | **Planned** | Compose and config are scaffolded and have **never been executed** |
| CI/CD | **Planned** | No pipeline |
| Admin dashboard | **Planned** | `apps/admin` is empty |
| Calendar, Contacts, Chat, Meet | **Planned** | All blocked behind Stalwart running |

## Three rules

**No fabricated data.** No fixture module, no seed data, no demo account. Every
value on screen comes from `GET /api/*` for the signed-in user; folder counts are
`COUNT(*)` per request; an empty inbox renders "Your inbox is empty". When a
request fails the UI shows the failure and offers a retry — it never falls back
to cached or invented mail, because people act on what they read.

*Enforced by review:* no component under `apps/web/components` or `apps/web/app`
may contain a literal message, address or count. Test fixtures live only in
`*.spec.ts`.

**No unmeasured performance claim.** Every performance figure in this project is
`NOT MEASURED`. The planning documents contained a "Verified Test Benchmarks"
section with specific figures for a system that had never been built; an audit
confirmed none of them ever entered this codebase, and none will without a
committed benchmark and the hardware it ran on.
See [ADR-0006](docs/adr/0006-benchmark-methodology.md).

**No capability claimed before it works.** Every external storage provider is
`status: "planned"`, `availableProviders()` returns `[]`, and a test fails the
moment that changes without a connector. `POST /api/storage/connections` returns
`501` for every provider. "Coming soon" beats a connect button that fails after
an OAuth round trip.

## Storage and limits

Every limit is an environment variable, enforced server-side, and served to the
client by `GET /api/config` — the frontend hardcodes none of them.

| Setting | Default | Why |
|---|---|---|
| `MAX_ATTACHMENT_SIZE_BYTES` | 100 MB | Storage is cheap; the real constraint is the receiver |
| `MAX_OUTBOUND_MESSAGE_SIZE_BYTES` | 25 MB | Body **and** attachments, measured before transfer encoding — the basis receivers actually publish |
| `MAX_USER_STORAGE_BYTES` | 15 GB | Per-user quota |
| `MAX_RECIPIENTS_PER_MESSAGE` | 100 | Matches the limit Google documents for SMTP submission |
| `SESSION_TTL_SECONDS` | 30 days | Session cookie lifetime |

Uploads stream and are capped **during** the stream, so an oversized file is
aborted rather than measured after it lands. Type is decided from magic bytes;
the browser's `Content-Type` is recorded as a claim and never trusted. HTML and
SVG are never served inline from this origin.

## Security highlights

`effectiveAccess()` intersects three layers and every layer can only **remove**
access:

```
effective = tenant ∧ mount ∧ provider
```

Provider credentials are AES-256-GCM sealed with the connection row id as AAD, so
a ciphertext copied into another row **fails to decrypt** — which defeats the
swap attack that would re-point one tenant's mount at another tenant's
credentials. Every decryption failure returns one identical message, so the
endpoint is not an oracle.

`'unsafe-eval'` is development-only (React's dev build needs it to reconstruct
call stacks). Verified 2026-08-20: the production client bundle contains zero
`eval` call sites. Full model, including what is *not* built, in
[docs/security.md](docs/security.md).

## Verification

```
turbo typecheck    3 successful, 3 total
turbo test         308 passing — types 57 · ui 33 · database 10 · web 208
next build         compiled successfully
```

## Documentation

Start at **[docs/](docs/)**. The most useful entry points:

- [Architecture status](docs/architecture-status.md) — what is actually built
- [Roadmap](docs/roadmap.md) — dependency-ordered, with the known gaps
- [Security model](docs/security.md) — and what is missing from it
- [Blueprint verification](docs/blueprint-verification.md) — planning documents
  checked against primary sources
- [Audit verification](docs/AUDIT-VERIFICATION.md) — pasted audit reports checked
  claim by claim against the repository
- [Composer audit](docs/COMPOSER-FINAL-AUDIT.md) — per-feature status with evidence

## License

AGPL-3.0.
