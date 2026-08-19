# ADR-0007 — Stalwart is the protocol and data authority

**Status:** Accepted, 2026-08-20. This ADR states the principle that ADR-0002
and ADR-0003 apply to Calendar and Contacts specifically.

## Context

The blueprints describe a system that implements its own mail transport, its own
calendaring, its own contacts, and its own migration tooling, with Stalwart
present but peripheral. Verification found that Stalwart v0.16.14 already
provides all four, to published standards, with interoperability that we would
have to rebuild and could not match quickly.

The governing question for each subsystem is not "can we build this" but "does
the platform underneath us already do this correctly, and what do we lose by
duplicating it".

## Decision

**Do not rebuild infrastructure the underlying platform already provides
correctly.**

```
  Stalwart      SMTP · IMAP4rev2 · JMAP · CalDAV · CardDAV · WebDAV · Sieve
      │         DKIM · DKIM2 · SPF · DMARC/DMARCbis · TLS · quotas · ACLs
      ▼
  Mail Server API / control plane
      │         tenancy · policy · federation · audit · unified search
      ▼
  Mail Server UI
                one experience across surfaces that speak different protocols
```

We own the **control plane** and the **product**. Stalwart owns the
**protocols** and the **mail/calendar/contacts data**.

### What this means per subsystem

| Subsystem | Stalwart provides | We build |
|---|---|---|
| Mail transport | SMTP, submission, IMAP4rev2, JMAP, routing, delivery, quotas | Client, control plane, product UX |
| Authentication of mail | DKIM (+DKIM2), SPF, DMARC/DMARCbis, TLS | Presentation of verdicts, policy UI |
| Anti-spam | Rspamd integration | Policy surface, quarantine UX |
| Calendar | CalDAV, iTIP, iMIP, free/busy, alarms | Client + product layer (ADR-0002) |
| Contacts | CardDAV, vCard, sync-tokens | Client + directory projection (ADR-0003) |
| Migration | Vandelay | An adapter, and only what Vandelay does not cover |

**We do not implement a second mail server inside Mail Server.**

### WebDAV versus Drive CAS

Stalwart's WebDAV (RFC 4918) offers file storage with locking, blob
deduplication, quota enforcement and principal discovery. That does not make it
a replacement for the native Drive layer, and the two are not competing:

```
Stalwart WebDAV          protocol/access layer — standards-based file access
                         for external clients, and the transport CalDAV and
                         CardDAV are themselves built on

Mail Server Drive CAS    native object storage — content addressing, dedup
                         across tenants, streaming with mid-stream size caps,
                         magic-byte type detection, per-user quota accounting
```

The decision rule: **if an external client needs to mount it, WebDAV; if the
product needs to own the bytes and their lifecycle, CAS.** One documented
limitation matters here — Stalwart disallows `Depth: Infinity` on file
collections to bound processing cost, so a recursive tree walk is not a WebDAV
operation we can rely on for large hierarchies.

We do not build a second storage implementation without a stated reason. Today
the reason is real: CAS gives us content addressing and dedup that WebDAV does
not expose, and attachment handling already depends on it.

### Vandelay

Vandelay is Stalwart's JMAP importer/exporter and backup tool.

| Vandelay handles | Status |
|---|---|
| IMAP, CalDAV, CardDAV, WebDAV, ManageSieve, Maildir sources | Provided |
| Google Takeout (recursive `.mbox`/`.ics`/`.vcf` scan) | Provided |
| Microsoft Exchange | Provided, **experimental** |
| Messages with full headers and flags, folder hierarchy | Provided |
| Sieve filters where the format permits | Provided |
| Calendars and events including recurrences | Provided |
| Address books; shared and delegated resources | Provided |
| Server-side rules where the source exposes them | Provided |

| Vandelay does not handle | Who owns it |
|---|---|
| Vendor-specific automation with no Stalwart equivalent | **Us** — surface it during assessment with a proposed replacement |
| End-user client configuration | Stalwart autoconfig/autodiscover |
| Tenant, billing and policy state in our platform tables | **Us** |
| Storage federation connections and mounts | **Us** |
| Progress reporting and migration UX for admins | **Us** — an adapter over Vandelay |

**Decision: delegate mail, calendar and contacts migration to Vandelay.** Build
an adapter that drives it and reports progress, plus migration for the platform
state Vandelay has no knowledge of. Do not write an IMAP importer.

## Alternatives considered

**Build everything in-process for a single deployable.** Rejected. The
operational simplicity is real but is bought with permanent ownership of four
protocol implementations, and correctness in mail authentication and calendar
recurrence is not a place to be second-best.

**Use Stalwart only as an MTA and own everything above it.** Rejected — this is
effectively the blueprint's plan, and it discards CalDAV/CardDAV/WebDAV/Vandelay
that already ship in the binary we deploy.

**Abstract over multiple mail engines from day one.** Rejected as premature. An
abstraction built against one implementation encodes that implementation's
assumptions anyway. If a second engine is ever needed, the control-plane
boundary is already the natural seam.

## Security implications

Delegating to Stalwart means delegating enforcement. Our client must **ask** and
**honour**, never assume — the same monotonic rule as `effectiveAccess()`: the
layer closest to the data is final in the restrictive direction. A UI that
computes its own idea of who may read a calendar, and shows it, is a disclosure
bug even when the protocol layer would have refused the fetch.

This also concentrates trust: a Stalwart compromise is a full mail, calendar and
contacts compromise. That argues for pinning the version (now done —
`stalwartlabs/stalwart:v0.16.14`, previously the unpinned `:latest`, which
contradicted the pinning rule in ADR-0001) and tracking its advisories.

## Performance implications

`NOT MEASURED`. Adding a protocol hop between our API and the data is a real
cost, and the honest position is that we have not measured it. It is the first
thing to benchmark once a Stalwart container runs (ADR-0006).

## Migration implications

Covered above: Vandelay for user data, ours for platform state.

## Status of verification

Every Stalwart capability cited here is **verified against upstream
documentation** and **not verified in this deployment**. There is no Docker in
the development environment, `infrastructure/stalwart/config.toml` has never
been loaded, and `localhost:8080` is unreachable. Standing up a container and
re-checking each capability is the first task in the roadmap.
