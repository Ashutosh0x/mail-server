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
[![Vitest](https://img.shields.io/badge/Vitest-167_passing-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](#license)
[![Typecheck](https://img.shields.io/badge/typecheck-3%2F3-success?style=flat-square)](#verification)
[![Tests](https://img.shields.io/badge/tests-167_passing-success?style=flat-square)](#verification)
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
> What is missing is SMTP/IMAP itself: nothing sends or receives mail yet.
> Full picture in **[docs/architecture-status.md](docs/architecture-status.md)**.

## Quick start

Node 22+ is the entire requirement. The database is SQLite through
`node:sqlite`, so there is no Docker, no Postgres service and no native build.

```bash
npm install
npm test                                   # 167 tests across four packages
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
| `apps/web` | Webmail client, account center, and 24 API routes | **built · 67 tests** |
| `benchmarks/` | Scenario definitions | **no results — nothing has been run** |
| `infrastructure/` | Compose, Stalwart and Rspamd config | scaffold, **never executed** |
| `services/api` | Rust/Axum gateway | not started |
| `apps/admin` | Admin dashboard | not started |

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
| `MAX_OUTBOUND_MESSAGE_SIZE_BYTES` | 18 MB | Base64 inflates ~37%, so this is ~25 MB on the wire |
| `MAX_USER_STORAGE_BYTES` | 15 GB | Per-user quota |

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
turbo test         167 passing — types 57 · ui 33 · database 10 · web 67
next build         compiled successfully
```

## Documentation

Start at **[docs/](docs/)**. The most useful entry points:

- [Architecture status](docs/architecture-status.md) — what is actually built
- [Roadmap](docs/roadmap.md) — dependency-ordered, with the known gaps
- [Security model](docs/security.md) — and what is missing from it
- [Blueprint verification](docs/blueprint-verification.md) — planning documents
  checked against primary sources

## License

AGPL-3.0.
