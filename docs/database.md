# Database

Two dialects, one schema. PostgreSQL is the production target; SQLite via
`node:sqlite` is development.

## Why two

Development needs to work with `npm install` and nothing else — no Docker, no
Postgres service, no native build step. `node:sqlite` is built into Node 22, so
`DatabaseSync` has zero install cost and the database file appears on first run.

Production needs partitioning, `tsvector` search, array columns and real
concurrency, which is Postgres.

The risk in that arrangement is obvious: two schemas drift, and the drift is
discovered in production. So `schema-parity.spec.mjs` compares the table sets
between dialects on every test run and fails on any difference not in an
explicit `POSTGRES_ONLY` / `SQLITE_ONLY` allowlist. It has already caught a real
drift — the mail tables existed in SQLite and not in Postgres, which produced
migration `0002`.

Parity is checked on **table sets**, not on behaviour. Postgres remains a target
that development does not exercise, and that gap is real.

## Migrations

`packages/database/migrations/`, applied by `migrate.mjs`.

| File | Tables | Contents |
|---|---|---|
| `0001_platform_schema.sql` | 19 | Tenants, users, sessions, domains, DKIM keys, audit, webhooks |
| `0002_mail_store.sql` | 7 | Mailboxes, threads, messages, labels, attachments |
| `0003_storage_federation.sql` | 4 | Connections, mounts, items, sync states |

The runner:

- records each file in `schema_migrations` with its **SHA-256**,
- applies each in a transaction,
- **aborts if an already-applied migration was edited** — silent divergence
  between what a database contains and what the repository says it contains is
  the failure this prevents,
- is a no-op when re-run.

```bash
npm run db:migrate:plan          # list files + checksums, touches nothing
DATABASE_URL=postgres://… npm run db:migrate
```

## Design decisions worth knowing

**Monthly partitioning with a `DEFAULT` catch-all.** High-volume tables
partition by month. The catch-all exists because a row with a timestamp outside
every declared range must be *stored*, not rejected — losing data to a missing
partition is worse than an unbalanced one. A maintenance function creates
upcoming partitions.

**`storage_mounts.visibility` defaults to `private` in the schema.** Not in
application code — in the `DEFAULT` clause, in both dialects. Connecting a
personal account must never make it visible to an organisation, and that
guarantee should survive someone writing a row by hand.

**`storage_items` uses `UNIQUE (connection_id, external_id)`.** The provider's
own id is never a primary key. Two providers will eventually issue the same id,
and a shared key space between connections is a cross-connection read.

**`storage_connections.encrypted_credentials` holds ciphertext bound to its own
row id.** A blob moved to another row fails to decrypt — see
[ADR-0005](adr/0005-provider-credential-security.md).

**Deleting a federated row deletes our reference, not the customer's file.**
The whole `storage_*` group encodes that we do not own external bytes.

## Local development

```
apps/web/.data/mailserver.db        SQLite database, created on first run
apps/web/.data/blobs/               attachment bytes, filesystem driver
```

Both are gitignored. There is no seed data and no demo account — an empty
mailbox is empty because it is.

Connection handling is in `lib/server/db.ts`: a `DatabaseSync` cached on
`globalThis` so hot reload does not open a new handle per request, with
`foreign_keys`, WAL journaling and a busy timeout set as pragmas. `transaction()`
wraps multi-statement work.

## Not built

- No connection pooling, because SQLite needs none and the Postgres path is not
  exercised yet.
- No read replicas, no sharding.
- No automated backup. Vandelay may cover the mail side — see
  [ADR-0007](adr/0007-stalwart-as-infrastructure-authority.md).
- The Postgres path has never run against a live server in this environment.
