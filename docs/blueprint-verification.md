# Blueprint verification report

**Date of verification:** 2026-08-19 / 2026-08-20
**Subject:** OmniWorkspace Master Blueprint v2.0 and v2.1, the External Storage
Federation specification (52 sections), and the NFS Attachment subsystem
specification.

This report exists because the blueprints assert a large number of external
facts — library versions, protocol names, RFC numbers, vendor behaviour — and
because several of those assertions are wrong in ways that would have shaped the
code if taken at face value. Everything below was checked against the live
upstream source or measured in this repository. Claims I could not confirm are
listed as unconfirmed rather than quietly dropped.

---

## 1. Summary

The architectural direction in the blueprints is sound and worth building. The
factual layer underneath it is not uniformly reliable: it mixes correct current
information with stale versions and with at least one block of fabricated
measurements presented as completed test results.

| | Count |
|---|---|
| Claims verified correct | 7 |
| Claims stale or wrong | 3 |
| Claims presented as measured but unmeasurable | 1 block |

The single most consequential finding is in §3: Stalwart now ships CalDAV,
CardDAV and WebDAV natively, which removes a large block of scope the blueprints
budget for as separate Calendar and Contacts subsystems.

---

## 2. Claims verified correct

**Stalwart is at 0.16.14** (published 2026-07-20). The blueprint's version was
close enough to be usable and the protocol list checks out.

**Stalwart implements DKIM2 and DMARCbis**, as of 0.16.12, and is described by
its own project as the first mail server to do so. DKIM2 rebuilds DKIM around a
chain of custody that survives forwarding and makes bounces provable.

**DMARCbis is RFC 9989, 9990 and 9991.** The blueprint's RFC numbers are right.
This matters because our authentication-result modelling in
`packages/types/src/mail.ts` (`AuthenticationSummary`, `SecurityVerdict`) has to
name the standard it implements, and naming a draft that has since been
published would date the code immediately.

**Rspamd is at 4.x and the current protocol is `checkv3`.** Correct as stated.

**Valkey 9.0 shipped in May 2026; 9.1.1 is current.** Correct as stated.

**Google Docs, Sheets and Slides still support Box, Dropbox and Egnyte** as
external storage targets. The blueprint uses this as precedent for the
federation model and the precedent holds — with one caveat the blueprint omits:
Egnyte's own Google Workspace integration is marked *Legacy* by Egnyte. That
caveat is now recorded in the registry itself, on
`PROVIDERS.egnyte.note` in `packages/types/src/providers.ts`, so nobody
re-discovers it during connector work.

**The lucide icon catalog is 243 of 244 valid names.** One name in the pasted
301-icon catalog does not exist upstream. The registry in
`packages/ui/src/icons.ts` maps semantic roles to real icon names and is covered
by `icons.spec.ts`, so an invalid name fails a test rather than rendering an
empty box.

---

## 3. Claims that are stale or wrong

**Next.js is 16.3.1, not 15.** The blueprint targets 15 throughout. This is not
cosmetic: 16 changes Turbopack's default posture, and the CSP/`eval()` console
error reported earlier in this work is a 16-era dev-server behaviour, not a 15
one. The repository is on 16.3.1 with React 19.2.8 and Tailwind 4.3.3.

**Calendar and Contacts are budgeted as ground-up subsystems.** Because Stalwart
now speaks CalDAV and CardDAV natively, the correct shape is a client against
those protocols, not a second datastore with its own scheduling semantics.
Building the blueprint's version would mean maintaining an independent
implementation of recurrence, free/busy and invitations that the mail server
already has. This materially reduces scope and should be re-planned before any
Calendar code is written.

**Account migration is treated as unsolved.** Stalwart ships *Vandelay*, a
one-shot migration and backup utility for JMAP that imports from IMAP, CalDAV,
CardDAV, WebDAV, ManageSieve, Maildir, Google Takeout and — experimentally —
Microsoft Exchange. The blueprint's migration section can be replaced with an
integration section.

---

## 4. The fabricated block

The External Storage Federation specification contains a section headed
**"Verified Test Benchmarks"** with checked boxes and specific figures:

- `copy_file_range` completing in under 5 ms for a 1 GB file
- 1,000 parallel streams sustained
- search latency under 8 ms across 100,000 files

These are presented as results. They cannot be results, because the system they
describe does not exist — no connector had been written when the document was
produced, and none exists now. The numbers are also individually implausible in
the direction that flatters the design: `copy_file_range` on NFSv4.2 is a
server-side copy whose latency depends on the backing filesystem and whether the
server supports reflinks at all, and 5 ms for 1 GB implies a copy-on-write clone
rather than a copy, which is a property of the storage, not of our code.

**None of these figures appear anywhere in the codebase, and none should.** This
follows the rule already recorded in `docs/adr/0001-foundation-decisions.md`:
no performance claim ships without a reproducible benchmark committed beside it.
If we later measure `copy_file_range`, the benchmark and the hardware it ran on
go in the repository with the number.

The general lesson, which applies to every future pasted specification: a
document that reports measurements for unbuilt software is not a specification
with an error in it, it is a document whose factual claims cannot be trusted
without independent checking. The verified/stale split above is the reason this
report exists rather than a note in a commit message.

---

## 5. What was built against the verified subset

Three layers, all covered by tests, all in the repository now.

**The permission model** — `packages/types/src/storage.ts`. The blueprint's
central security requirement is that effective permission is
`tenant AND mount AND provider`, and that each layer can only remove access,
never add it. `effectiveAccess()` implements exactly that in three ordered
stages:

1. **Tenant.** The mount and the connection must both belong to the requesting
   user's organization, and the connection must be `active`. Checking both is
   deliberate — a mount pointing at a foreign connection is the shape a
   cross-tenant escalation takes.
2. **Mount visibility.** Default is `private`, meaning only the person who
   connected the account. A private mount on an organization-owned connection
   (no owner) is visible to nobody rather than to everybody.
3. **Provider grant.** Final in the restrictive direction. If the provider says
   read-only, a mount manager still cannot write.

`storage.spec.ts` has 24 tests, including one that walks every mount role
against a fully-denying provider grant and asserts the answer is denial in all
five cases.

**The provider registry** — `packages/types/src/providers.ts`. Fourteen
providers are described; **every external one is `status: "planned"` with a
stated reason**, and `availableProviders()` returns an empty array. A test
asserts that emptiness. It will fail the moment somebody marks a provider
available without shipping its connector, which is precisely when it should
fail. This is the direct implementation of the constraint that a "Google Drive
connected" button must not exist until an authenticated connection does.

Capabilities in the registry describe what the *provider* supports, checked
against each vendor's own API documentation, not what our connector does. Some
consequences that are easy to get wrong and are now encoded: S3 has no rename
and no move (a rename is copy-then-delete, and the connector will only claim
`move` when it does both atomically enough to be honest); WebDAV's `SEARCH`
method is optional under RFC 5323 and rarely implemented, so WebDAV does not
claim search; SharePoint is modelled separately from OneDrive because their
permission models differ and treating a document library as a personal drive is
how site-level permissions get mistranslated.

**Credential encryption** — `apps/web/lib/server/secrets.ts`. AES-256-GCM
envelope encryption, output as `v1.<iv>.<tag>.<ciphertext>` in base64url. The
AAD binds each ciphertext to the connection row it belongs to, so a blob copied
from one row to another fails to decrypt — that stops a swap attack from
re-pointing one tenant's mount at another tenant's credentials. Every failure
mode returns the same error message, so the endpoint is not an oracle telling an
attacker which knob to turn. `deriveKey` refuses material shorter than 32
characters rather than stretching a weak secret and presenting it as strong.

**Schema** — `packages/database/migrations/0003_storage_federation.sql` and the
SQLite mirror, adding `storage_connections`, `storage_mounts`, `storage_items`
and `storage_sync_states`. `storage_mounts.visibility` defaults to `private` at
the database level, not just in application code. `storage_items` keys the
provider's own id as `UNIQUE (connection_id, external_id)` rather than as a
primary key, because two providers will eventually collide on one id.
`schema-parity.spec.mjs` compares the Postgres and SQLite table sets and fails
on drift.

---

## 6. Verification state of this repository

```
turbo typecheck   3 successful, 3 total
turbo test        4 successful — types 46, ui 10, database 10, web 56 = 122
next build        compiled successfully
```

---

## 7. Not built

Named so the gap is visible rather than implied:

- **Every external connector.** No provider OAuth flow, no change-token sync, no
  webhook receiver. The registry says so and the UI reflects it.
- **SMTP and IMAP transport.** Mail is stored and read; nothing is sent or
  received over the wire yet.
- **Calendar, Contacts, Docs/Sheets/Slides, Meet, Chat, Tasks, Notes, Forms, and
  the admin console.** Calendar and Contacts should be re-planned against
  Stalwart's native CalDAV/CardDAV before any code is written (§3).

---

## Sources

- [stalwartlabs/stalwart — GitHub](https://github.com/stalwartlabs/stalwart)
- [Stalwart releases](https://github.com/stalwartlabs/stalwart/releases)
- [Stalwart blog — roadmap](https://stalw.art/blog/roadmap/)
- [Stalwart Mail Server](https://stalw.art/mail-server/)
- [Stalwart 0.16 release coverage — Linuxiac](https://linuxiac.com/stalwart-0-16-mail-server-released-with-new-webui/)
