# Architecture

Live status per component is in
[architecture-status.md](architecture-status.md). This page explains the shape
and why it is that shape.

## The governing principle

> Do not rebuild infrastructure the underlying platform already provides
> correctly.

Stalwart owns the protocols and the mail, calendar and contacts data. We own the
control plane and the product. Stated fully in
[ADR-0007](adr/0007-stalwart-as-infrastructure-authority.md).

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

This principle produced the largest correction in the project's history. The
original blueprints planned ground-up Calendar and Contacts subsystems, each
with its own datastore. Verification found Stalwart already ships CalDAV with
scheduling and CardDAV with sync-tokens, so both were rearchitected as clients —
see [ADR-0002](adr/0002-calendar-architecture.md) and
[ADR-0003](adr/0003-contacts-architecture.md). Recurrence, iTIP/iMIP, free/busy
and vCard parsing left the roadmap entirely.

## Layers as they exist today

```
   apps/web
   ├── app/                 pages + 14 API route handlers  ← the API today
   ├── components/          webmail shell (no literal mail data, ever)
   └── lib/server/          auth · db · mail · attachments · storage · secrets

   packages/types           domain contract · search grammar · federation
   packages/ui              OKLCH tokens · icon registry
   packages/database        migrations · dual-dialect schema · runner
```

The Rust/Axum gateway from the blueprints does not exist. The Next.js route
handlers are the API, and saying so is more useful than a diagram of a service
that has never been written.

### `packages/types` is deliberately load-bearing

Anything two call sites must agree on lives here, because two implementations of
one rule are two chances to get it wrong in one direction only. Concretely:

- **The search grammar** is parsed once and shared by the filter chips and the
  SQL layer, so a chip cannot say something the query does not do.
- **`effectiveAccess()`** is one function, so every federation call site
  computes permission identically.
- **The provider registry** is one table, so the UI and the API cannot disagree
  about whether a connector exists.

## Storage: two layers that are not competing

```
Stalwart WebDAV        protocol/access layer — standards-based file access for
                       external clients; the transport CalDAV and CardDAV are
                       themselves built on

Drive CAS (ours)       native object storage — content addressing, dedup,
                       streaming with mid-stream size caps, magic-byte type
                       detection, quota accounting

External federation    the provider owns the bytes; we hold a reference
```

The rule: **if an external client needs to mount it, WebDAV; if the product
needs to own the bytes and their lifecycle, CAS.**

Federation's central distinction is ownership. For an external provider we do
not own the bytes — deleting our row deletes *our reference*, not the customer's
file. Content becomes ours only on explicit import. Getting that backwards means
a database tidy-up destroys customer data.

Permission is the intersection of three layers, and every layer can only remove:

```
effective = tenant ∧ mount ∧ provider
```

Details in [ADR-0004](adr/0004-external-storage-federation.md).

## Data flow for a mail read

```
browser ──GET /api/mail?q=…──► requireUser()        401 if no session
                               parseQuery()          shared grammar
                               buildWhere()          bound params, never
                                                     interpolated
                               scoped by userId      not filtered after
                               keyset pagination     on (received_at, id)
        ◄──────────────────────  threads + cursor
```

Keyset rather than `OFFSET` because `OFFSET` both degrades linearly and, when
the underlying set changes between pages, skips or repeats rows — which in a
mailbox means a message silently missing from a scroll.

## Frontend

Next.js **16.3.1** (the blueprints said 15 — the version was stale, and the
project stays on 16.3.1), React 19.2.8, Tailwind v4.3.3 with CSS-first `@theme`.

Design tokens are OKLCH. The property that earns it: perceptual uniformity lets
twelve label colours be generated at fixed lightness and chroma across twelve
hues, so no colour appears louder than another. Light and dark are both defined
for `prefers-color-scheme` *and* an explicit `data-theme`, so a manual choice
wins in both directions.

Icons go through a semantic registry — call sites ask for `icons.mailbox.inbox`,
never a lucide export — so an upstream rename is one edit, and a test fails the
build if an entry stops resolving.

**No production component contains literal mail data.** Every value comes from
`GET /api/*` for the signed-in user. Counts are `COUNT(*)` per request. An empty
inbox says so. A failed request shows the failure and offers a retry, and never
falls back to cached or invented mail — people act on what they read.

## What is not built

Named plainly rather than implied: SMTP, IMAP, JMAP clients; compose; HTML email
rendering; Calendar; Contacts; every external storage connector; Docs, Sheets,
Slides; Meet; Chat; the admin console; the Rust gateway.

None of it is stubbed or faked. It does not exist, the UI says so where a user
would otherwise expect it, and the [roadmap](roadmap.md) gives the order.
