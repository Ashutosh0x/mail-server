# Architecture status

**Last updated:** 2026-08-20
**Baseline:** `turbo typecheck` 3/3 · `turbo test` 226 passing · `next build` clean

This is the single source of truth for what exists. It supersedes every status
claim in the original planning blueprints. Where this file and a blueprint
disagree, this file is correct.

## How to read the status column

| Status | Meaning |
|---|---|
| `VERIFIED` | Checked against a primary source, with the evidence named |
| `IMPLEMENTED` | Working code in this repository, covered by tests |
| `PARTIALLY_IMPLEMENTED` | Some layers real, others absent — the gap is stated |
| `PLANNED` | Designed, not written. No code claims otherwise |
| `STALE` | A blueprint assumption that verification disproved |
| `REMOVED` | Deliberately deleted, with the reason |
| `BLOCKED` | Cannot proceed until a named dependency exists |

A capability verified in *Stalwart's documentation* is not the same as a
capability verified in *this deployment*. Nothing here has been exercised
against a running Stalwart: there is no Docker in the development environment,
`infrastructure/stalwart/config.toml` has never been loaded, and
`http://localhost:8080` is unreachable. Upstream-documented capabilities are
therefore `VERIFIED` **upstream** and `BLOCKED` locally, and both are shown.

---

## Component status

| Component | Status | Evidence | Next action |
|---|---|---|---|
| **Mail engine** (Stalwart) | `VERIFIED` upstream · `BLOCKED` locally | v0.16.14, published 2026-07-20. Now pinned in `docker-compose.yml` | Stand up a container; run the config through it |
| **SMTP** | `PLANNED` | Provided by Stalwart. No client code here. `SMTP_HOST` unset disables the composer with a reason | Build the submission client (ADR-0007) |
| **IMAP** | `PLANNED` | Provided by Stalwart (IMAP4rev2). No client code here | Prefer JMAP; IMAP only for legacy clients |
| **JMAP** | `PLANNED` | Provided by Stalwart. Our domain types are already JMAP-shaped | `packages/types/src/mail.ts` is the contract; write the client |
| **Calendar** | `PLANNED` — **rearchitected** | Was "ground-up datastore". Superseded by ADR-0002 | Build a CalDAV client layer, not a datastore |
| **CalDAV** | `VERIFIED` upstream | RFC 4791 + Scheduling Extensions RFC 6638, iTIP (RFC 5546), iMIP (RFC 6047), free/busy, server-side alarms, HTTP RSVP | Consume it. Do not reimplement it |
| **Contacts** | `PLANNED` — **rearchitected** | Was "ground-up datastore". Superseded by ADR-0003 | Build a CardDAV client layer |
| **CardDAV** | `VERIFIED` upstream | RFC 6352, vCard address books, sync via RFC 6578 sync-tokens | Consume it |
| **WebDAV** | `VERIFIED` upstream | RFC 4918 with locking, blob dedup, quota checks, `PrincipalPropFind`. Depth `Infinity` disallowed on file collections | Scope against Drive CAS per ADR-0007 §WebDAV |
| **Drive — native storage** | `PARTIALLY_IMPLEMENTED` | `lib/server/storage/` provider layer: filesystem + NFS with real health probes, atomic writes, ranges; 27 tests | S3 provider; reconciliation; the Drive product itself |
| **External storage federation (core)** | `IMPLEMENTED` | `packages/types/src/storage.ts`, 24 tests in `storage.spec.ts`, migration `0003` | Hold the model; add connectors in phases |
| **Google Drive connector** | `PLANNED` | `PROVIDERS.google_drive.status === "planned"` | Phase 2 (ADR-0004) |
| **Dropbox connector** | `PLANNED` | Registry `planned` | Phase 4 |
| **OneDrive / SharePoint connector** | `PLANNED` | Registry `planned`, modelled separately | Phase 3 |
| **S3 connector** | `PLANNED` | Registry `planned` | **Phase 1 — the first connector to build** |
| **NFS storage provider** | `IMPLEMENTED` (unverified against a real export) | `lib/server/storage/nfs.ts`; mount verification via statfs magic + device-id boundary; ESTALE as a backend fault | Mount a real export and re-verify |
| **Box / Egnyte connectors** | `PLANNED` | Registry `planned`. Egnyte's own Workspace integration is Legacy | Phase 4 |
| **WebDAV / SFTP connectors** | `PLANNED` | Registry `planned` | Phase 5 |
| **SMB / NFS connectors** | `PLANNED` | Registry `planned`, host-mounted only | Phase 6, evaluate first |
| **Docs / Sheets / Slides** | `PLANNED` | No code | Blocked on a CRDT decision; not started |
| **Meet** | `PLANNED` | No code | Last in the roadmap |
| **Chat** | `PLANNED` | No code | After Admin |
| **Search** | `IMPLEMENTED` (mail only) | Grammar in `packages/types/src/search.ts`, 46 tests; translated to bound SQL in `lib/server/mail.ts` | Extend to Drive and federated items |
| **Identity / auth** | `IMPLEMENTED` | scrypt (N=2^15, r=8, p=1), SHA-256 session tokens, `secure` cookies in production | Add MFA, OIDC |
| **Passkeys / WebAuthn** | `IMPLEMENTED` | Registration and sign-in, verified end to end against Chrome’s virtual authenticator; single-use challenges, clone detection via sign count | Recovery codes so a lost passkey is not a lockout |
| **Admin** | `PLANNED` | No app under `apps/admin` | After mail transport |
| **Backup** | `PLANNED` | None | Evaluate Vandelay (ADR-0007) |
| **Migration** | `PLANNED` — **rearchitected** | Stalwart ships Vandelay | Delegate; build only the adapter (ADR-0007) |
| **AI** | `PLANNED` | No code, no provider configured | Requires explicit consent design before any data leaves the tenant |

---

## Superseded blueprint assumptions

| Blueprint said | Reality | Where corrected |
|---|---|---|
| Next.js 15 | Project runs **16.3.1** | ADR-0001; no code change — 16.3.1 is kept |
| Ground-up Calendar datastore | Stalwart provides CalDAV + scheduling | **SUPERSEDED** by ADR-0002 |
| Ground-up Contacts datastore | Stalwart provides CardDAV | **SUPERSEDED** by ADR-0003 |
| Custom migration subsystem | Stalwart ships Vandelay | **SUPERSEDED** by ADR-0007 |
| "Verified Test Benchmarks" with figures | Never measured; system did not exist | **REMOVED** — see below |

## Performance claims

Every performance figure in this project carries one of five labels:

| Label | Means |
|---|---|
| `MEASURED` | A committed benchmark produced it, on recorded hardware |
| `TARGET` | A goal we intend to design toward |
| `ESTIMATED` | Derived from a documented property of a dependency |
| `THEORETICAL` | An upper bound from first principles |
| `NOT MEASURED` | No data. The default |

The three figures the blueprints presented as test results —
`copy_file_range` under 5 ms for 1 GB, 1,000 parallel streams, sub-8 ms search
across 100,000 files — are **`TARGET`, status `NOT MEASURED`**. They were never
results. A repository-wide audit on 2026-08-20 confirmed **none of them ever
entered the codebase**; they appear only in `blueprint-verification.md`, which
exists to label them as fabricated. Methodology for producing real numbers is in
[ADR-0006](adr/0006-benchmark-methodology.md) and
[`benchmarks/external-storage/`](../benchmarks/external-storage/).

## Security invariants that must not regress

These are load-bearing. Each has a test that fails if it is weakened.

1. **`effectiveAccess()` is monotonic.** Tenant ∧ mount ∧ provider. Every layer
   can only remove access. `storage.spec.ts` walks all five mount roles against
   a fully-denying provider grant and asserts denial in every case.
2. **No provider is connectable without a connector.** `availableProviders()`
   returns `[]`, and a test asserts that emptiness. `POST
   /api/storage/connections` returns `501` for every provider.
3. **Credentials are AES-256-GCM with the row id as AAD.** A blob moved between
   rows fails to decrypt. All failure modes return one message, so the endpoint
   is not an oracle.
4. **`storage_mounts.visibility` defaults to `private` in the schema**, in both
   Postgres and SQLite — not only in application code.
5. **Attachment type comes from magic bytes**, never the browser's
   `Content-Type`. HTML and SVG are never served inline.
6. **Attachment ownership is part of the lookup**, so changing an id in the URL
   returns 404 rather than another user's file.
7. **`'unsafe-eval'` is development-only.** Verified 2026-08-20: the production
   client bundle contains zero `eval` call sites across all 11 chunks.
