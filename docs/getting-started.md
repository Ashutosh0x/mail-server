# Getting started

## Requirements

**Node 22 or newer.** That is the whole list for development.

The database is SQLite through `node:sqlite`, which is built into Node 22 — no
Docker, no Postgres service, no native module compile. Everything else is npm
packages.

## Run it

```bash
npm install
npm test                                    # 133 tests across four packages
npm --workspace @mailserver/web run dev      # http://localhost:3000
```

Open http://localhost:3000 and create an account. The database file appears at
`apps/web/.data/mailserver.db` on first run.

Your inbox will be empty. That is correct — there is no seed data, no demo
account and no fixture mail anywhere in the product path. It is empty because it
is empty.

## What works right now

You can register, log in, browse mailboxes, create labels, run the full search
grammar, upload and download attachments, and apply bulk actions to messages.

You cannot send or receive mail. Nothing does — there is no SMTP or IMAP client
yet. `SMTP_HOST` unset disables the composer with a stated reason rather than
accepting a message it cannot deliver. See the
[roadmap](roadmap.md) for the order things are being built in.

## Verify the build

```bash
npm run typecheck     # 3 packages
npm test              # 133 tests
npm run build         # turbo: builds every package
```

## Configuration

Copy `.env.example` to `.env`. Every value is read by the **server**; none is
baked into the browser bundle. The client learns limits from `GET /api/config`.

Nothing needs to be set for local development. Defaults are in
[configuration.md](configuration.md).

The one variable to know about early is `SECRETS_KEY`, needed once storage
federation is used. It must be at least 32 characters:

```bash
openssl rand -base64 32
```

Short values are refused at startup rather than stretched and treated as strong.

## Postgres

SQLite is development. Postgres is the production target.

```bash
npm run db:migrate:plan                      # list migrations + checksums
DATABASE_URL=postgres://… npm run db:migrate
```

The runner records each migration with a SHA-256 checksum and **aborts if an
already-applied file was edited**. Re-running is a no-op.

Be aware: the Postgres path is not exercised by development or by CI in this
environment. The parity test compares table sets between dialects, not
behaviour. See [database.md](database.md).

## The full stack

`docker-compose.yml` brings up Postgres, Valkey, MinIO, Stalwart, Rspamd and
ClamAV, with images pinned to versions.

**It has never been run.** There is no container runtime in the development
environment used so far, `infrastructure/stalwart/config.toml` has never been
loaded, and no capability has been verified against a running server. Treat all
of `infrastructure/` as unverified scaffold. Standing this up is stage 1 of the
roadmap, and it gates most of what comes after.

## Repository layout

```
apps/web             webmail client + the API routes (these ARE the API today)
packages/types       domain contract, search grammar, storage federation
packages/ui          design tokens, icon registry
packages/database    migrations, dual-dialect schema, migration runner
docs                 architecture, ADRs, security, API reference
benchmarks           scenario definitions. No results — nothing has been run
infrastructure       compose config. Never executed
```

## Troubleshooting

**A build wiped the dev server's styles.** `next build` and `next dev` share
`.next`. Stop dev, delete `.next`, restart dev.

**`.next` will not delete.** A dev server is holding it. Stop the Node process
first.

**Console error about `eval` and CSP in development.** Expected. React's
development build uses `eval()` to reconstruct call stacks, so `'unsafe-eval'`
is permitted in development only. The production bundle contains no `eval` — see
[security.md](security.md).
