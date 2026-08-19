# Roadmap

Ordered by dependency, not by ambition. Each stage exists because the one after
it cannot be built honestly without it.

Status vocabulary is defined in [architecture-status.md](architecture-status.md).
Nothing here is a delivery date.

```
  0  Foundation                          IMPLEMENTED
        │   types · UI tokens · schema · auth · attachments · search grammar
        ▼
  1  Stalwart deployment                 BLOCKED — no container runtime yet
        │   the whole stack below depends on the engine actually running
        ▼
  2  Mail transport                      PLANNED
        │   JMAP client · submission · compose · HTML rendering pipeline
        ▼
  3  Calendar + Contacts                 PLANNED  (ADR-0002, ADR-0003)
        │   CalDAV / CardDAV clients over the engine from stage 1
        ▼
  4  Drive + storage federation          core IMPLEMENTED, connectors PLANNED
        │   S3 first, then OAuth providers  (ADR-0004)
        ▼
  5  Admin                               PLANNED
        │   needs real tenants, real mail and real mounts to administer
        ▼
  6  Collaboration (Docs/Sheets/Slides)  PLANNED
        │   blocked on a CRDT decision that has not been made
        ▼
  7  Chat                                PLANNED
        ▼
  8  Meet                                PLANNED
```

## Stage 1 — Stand up Stalwart

**This is the next task, and it gates most of the rest.**

Every Stalwart capability this project depends on is currently verified against
upstream documentation and **not** verified in this deployment. There is no
Docker in the development environment, `infrastructure/stalwart/config.toml` has
never been loaded, and `localhost:8080` is unreachable.

1. Provide a container runtime.
2. Bring up the pinned stack — images are now pinned rather than `:latest`,
   which previously contradicted the pinning rule in ADR-0001.
3. Re-verify, against the running server rather than the docs: CalDAV
   collections and scheduling, CardDAV address books, WebDAV file access, JMAP,
   SMTP submission, and DKIM/SPF/DMARC results.
4. Record the outcome in `architecture-status.md`, moving rows from
   `VERIFIED upstream` to `VERIFIED`.

Any capability that fails re-verification changes the plan. That is the point of
doing it before writing clients.

## Stage 2 — Mail transport

The product is a mail client that cannot yet send or receive mail. Order within
the stage:

1. **JMAP client** against Stalwart. Our domain types in
   `packages/types/src/mail.ts` are already JMAP-shaped, so this is a transport,
   not a remodel.
2. **Submission.** `SMTP_HOST` unset already disables the composer with a stated
   reason; sending is never faked.
3. **Compose.** Deliberately last of the three — a composer that cannot deliver
   is the fake-send failure mode.
4. **HTML email rendering.** Requires the full pipeline before any untrusted
   HTML reaches a DOM: sanitise → block remote images → strip trackers →
   sandboxed iframe with its own CSP. Until then the reading pane shows the
   plain-text preview and says so.

## Stage 3 — Calendar and Contacts

Rearchitected. Build clients, not datastores — see ADR-0002 and ADR-0003. The
scope removed here (recurrence engine, iTIP/iMIP state machine, free/busy
computation, vCard parser, address-book sync) is the largest single reduction
that verification produced.

## Stage 4 — Storage federation connectors

Core is implemented and tested. Connectors go in phases (ADR-0004):

| Phase | Provider | Gate |
|---|---|---|
| 1 | S3-compatible | Contract suite green against MinIO |
| 2 | Google Drive | OAuth client + public webhook endpoint |
| 3 | OneDrive / SharePoint | Microsoft Graph, two permission models |
| 4 | Dropbox, Box, Egnyte | Reuses phase 2's OAuth shape |
| 5 | WebDAV, SFTP | Credential-based |
| 6 | SMB, NFS | Evaluate before building; host-mounted only |

A provider moves from `planned` to `available` only when all eight conditions in
ADR-0004 hold and `meetsContract()` returns ready. Not before, and never because
a UI button exists.

## Known gaps that are not features

Real debts, recorded so they are not mistaken for completeness:

- **Credential key rotation is not built.** `SECRETS_KEY` compromise currently
  requires re-authorising every connection. The `v1.` version prefix leaves the
  path open (ADR-0005).
- **No benchmark has ever been executed.** Every performance claim is
  `NOT MEASURED` (ADR-0006).
- **`infrastructure/` has never been run.** Treat all of it as unverified.
- **No MFA, no OIDC.** Password plus session cookie is the whole of identity.
- **No rate limiting beyond login.** Other endpoints are unprotected.
- **Postgres is a target, not a tested path.** Development runs SQLite; the
  parity test compares table sets, not behaviour.
