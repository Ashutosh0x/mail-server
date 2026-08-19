# Mail Server documentation

Start here. Each page states what exists today and what does not — nothing here
describes a planned feature in the present tense.

**[architecture-status.md](architecture-status.md) is the source of truth for
what is built.** Where any other document disagrees with it, it wins.

## For people running it

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, run, migrate, first account |
| [Configuration](configuration.md) | Every environment variable, its default, and why |

## For people building on it

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | The layers, the governing principle, and what is missing |
| [Architecture status](architecture-status.md) | Per-component status table with evidence |
| [Roadmap](roadmap.md) | Dependency-ordered build order, and the known gaps |
| [API reference](api.md) | All fourteen route handlers |
| [Database](database.md) | Dual-dialect schema and the migration runner |
| [Search grammar](search.md) | The query language shared by chips and SQL |
| [Connectors](connectors.md) | The provider registry and the connector contract |

## For people reviewing it

| Page | What it covers |
|---|---|
| [Security model](security.md) | Every control, the threat it answers, and what is *not* built |
| [Blueprint verification](blueprint-verification.md) | Planning documents checked against primary sources |
| [Benchmark scenarios](../benchmarks/external-storage/) | Definitions only. **No results — nothing has been run** |

## Decision records

| ADR | Decision |
|---|---|
| [0001](adr/0001-foundation-decisions.md) | Foundation: which schema won, why versions are pinned from the registry |
| [0002](adr/0002-calendar-architecture.md) | Calendar is a **CalDAV client**, not a datastore |
| [0003](adr/0003-contacts-architecture.md) | Contacts is a **CardDAV client**, plus a directory projection |
| [0004](adr/0004-external-storage-federation.md) | Federation: `tenant ∧ mount ∧ provider`, connectors in phases |
| [0005](adr/0005-provider-credential-security.md) | AES-256-GCM with the row id as AAD |
| [0006](adr/0006-benchmark-methodology.md) | What may be called a measurement |
| [0007](adr/0007-stalwart-as-infrastructure-authority.md) | Stalwart owns the protocols; we own the product |

## Three rules that run through all of it

**No fabricated data.** No fixture module, no seed data, no demo account. An
empty inbox renders as empty. A failed request renders as failed with a retry.
Nothing falls back to invented mail, because people act on what they read.

**No unmeasured performance claim.** `benchmarks/` holds scenario definitions
and zero results. Every performance figure in this project is currently
`NOT MEASURED`. The words *verified*, *tested*, *measured* and *benchmark* may
not describe a number that no benchmark produced — see
[ADR-0006](adr/0006-benchmark-methodology.md).

**No capability claimed before it works.** Every external storage provider is
`planned`, `availableProviders()` returns `[]`, and a test fails if that changes
without a connector. "Coming soon" beats a button that fails after an OAuth
round trip.
