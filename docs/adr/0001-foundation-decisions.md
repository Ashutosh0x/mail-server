# ADR 0001 — Foundation decisions

Status: accepted · Date: 2026-08-19

The architecture plan, the UI/UX report and the icon catalog each assume things
the existing scaffold contradicts, or that turned out not to be true when
checked. This record exists so those points are not re-litigated every time
someone opens the repo.

## 1. Versions are pinned from the registry, not from the plan

The plan specifies "Next.js 15+". The current release is **Next.js 16.3.1**, so
that is what is installed. Everything else was likewise read from the npm
registry on 2026-08-19 rather than copied from the document:

| Package | Plan said | Installed |
|---|---|---|
| next | 15+ | 16.3.1 |
| react | 19+ | 19.2.8 |
| tailwindcss | 4+ | 4.3.3 |
| lucide-react | "1,700+ icons" | 1.33.0 |
| @tanstack/react-query | v5 | 5.101.x |

**lucide-react has since reached 1.x**, which the icon catalog predates. The
catalog names 301 icons; a name list written against a pre-1.0 release cannot be
assumed to still resolve. `packages/ui/src/icons.ts` therefore imports every
icon it names, and `icons.spec.ts` fails if any of them is missing — so a
renamed icon breaks a test rather than a page.

## 2. Two schemas existed. The plan's wins, and the scaffold's is superseded

`packages/database/migrations/001_initial_schema.sql` (pre-existing) and section
E of the plan model the same domain differently:

| | Scaffold | Plan | Kept |
|---|---|---|---|
| `aliases` destination | single `target` | `destination TEXT[]` | Plan — one alias fanning out to several addresses is the common case |
| DKIM private key | `dkim_private_key` plaintext | `dkim_private_key_enc` | Plan — a private key in a readable column is a finding, not a design |
| `users` | no quota, no MFA | quota, MFA, role, locale | Plan |
| `domains` | `is_verified` bool | per-record `mx/spf/dkim/dmarc_verified` | Plan — the DNS wizard has to report which record is missing, not just "not verified" |
| Partitioning | `DEFAULT` partition only | monthly partitions | Neither — see 3 |

The scaffold migration is **replaced**, not amended: it was never applied
anywhere (no Docker, no database in this environment, no migration ledger), so
there is nothing to migrate from.

## 3. Partitioning needs a maintenance job, not just a partitioned table

Both the scaffold and the plan declare `delivery_events` and `audit_logs`
`PARTITION BY RANGE (created_at)`. The scaffold then creates only a `DEFAULT`
partition — so every row lands in one table and the partitioning buys nothing.
The plan creates a single month (`2026_08`) and stops, which is the same problem
one month later, plus writes start failing once the range is exceeded.

This repo ships `create_month_partition()` and a `DEFAULT` catch-all, so a row
outside every declared range is still stored rather than rejected. Creating next
month's partition is a scheduled job — tracked, not assumed.

## 4. Migrations are tracked

`npm run db:migrate` was `psql -f 001_initial_schema.sql`, which fails on the
second run and has no record of what was applied. Replaced with a runner that
records every file in `schema_migrations` with its SHA-256, applies each inside
a transaction, and refuses to run if a previously-applied file has been edited.

## 5. The API gateway stays out of `workspaces` — deliberately

Root `package.json` declares `["apps/*", "packages/*"]`, so `services/api` was
never picked up. That is now correct rather than accidental: per the plan the
gateway is **Rust/Axum**, so it is a Cargo crate and has no business in an npm
workspace. `services/api` is a Cargo project; the npm workspace globs are
unchanged.

## 6. What "verified" means for claims in the plan

Checked and true, so used as-is:

- Stalwart is dual-licensed AGPL-3.0 / Enterprise. AGPL obligations attach to
  redistributing or offering *modified* versions as a service.
- DMARCbis was published May 2026 as **RFC 9989** (core), 9990 (aggregate
  reporting) and 9991 (failure reporting), replacing RFC 7489 and moving DMARC
  to Proposed Standard. The plan's `np=` tag in its example record is a
  DMARCbis addition and is correct.
- MTA-STS is RFC 8461, TLS-RPT is RFC 8460, one-click unsubscribe is RFC 8058,
  JMAP is RFC 8620/8621 with WebSocket in 8887.

Not checked, and therefore **not repeated as fact anywhere in this codebase**:
every performance number in the plan ("3–13× faster than Dovecot+Solr",
"50,000+ docs/sec", "~512 MB vs 6–8 GB", the weighted scorecard totals). The
plan itself says benchmarks will not be claimed without reproducible data; that
applies to the numbers used to pick the stack too. They are motivation, not
measurements, until `benchmarks/` produces our own.
