# ADR-0004 — External storage federation

**Status:** Accepted, 2026-08-20. Core implemented; connectors phased.

## Context

Users keep files in storage they already own — Google Drive, S3 buckets,
SharePoint, an SFTP host. Attaching one to a message should not require copying
it into our system first.

That creates a category distinction the whole design turns on:

```
native    we own the bytes and their lifecycle
external  the provider is the source of truth; we hold a reference
```

Deleting a federated item row deletes *our reference*, not the customer's file.
Content becomes ours only when a user explicitly imports it, at which point it
is a native file. Getting this backwards means a tidy-up job in our database
destroys a customer's data.

## Decision

### 1. The permission model is monotonic

```
effective = tenant  ∧  mount  ∧  provider
```

Implemented in `packages/types/src/storage.ts` as three ordered stages:

1. **Tenant.** Mount and connection must both belong to the caller's
   organisation, and the connection must be `active`. Both are checked — a mount
   pointing at a foreign connection is the shape a cross-tenant escalation takes.
2. **Mount visibility.** `private` (default) means the connection owner only.
   `organization`, `group` and `users` widen it explicitly. A `private` mount on
   an organisation-owned connection with no owner resolves to *nobody*, not
   everybody.
3. **Provider grant.** Final in the restrictive direction. A provider that says
   read-only makes a mount manager read-only.

**No layer can grant what an outer layer withheld.** `storage.spec.ts` asserts
this exhaustively: all five mount roles against a fully-denying provider grant,
denial expected in every case. This property must not regress.

Write and delete additionally require both a provider capability and a role
floor — `contributor` for write, `content_manager` for delete.

### 2. A provider is not offered until its connector exists

`PROVIDERS` describes fourteen providers. Every external one is
`status: "planned"` with a stated reason. `availableProviders()` returns `[]`,
and a test asserts that emptiness — it fails the moment someone marks a provider
available without shipping the connector, which is exactly when it should fail.

`POST /api/storage/connections` returns `501 connector_not_implemented` with the
provider's note. There is no code path that writes a connection row for a
provider that cannot list a file.

**A provider becomes `available` only when all eight hold:**

1. Connector implementation exists
2. Authentication works against the real provider
3. Connection validation works
4. The declared CRUD operations work
5. Error handling exists for provider failure and rate limits
6. Permission checks map the provider's grants into `ProviderGrant`
7. Unit tests exist
8. The contract suite passes against a real or emulated endpoint

### 3. Capabilities describe the provider, not our connector

The registry records what each vendor's API supports, checked against its own
documentation. Consequences that are easy to get wrong and are now encoded:

- **S3 has no rename and no move.** A rename is copy-then-delete. `move` is
  claimed only once the connector does both atomically enough to be honest.
- **WebDAV's `SEARCH` (RFC 5323) is optional** and rarely implemented, so
  WebDAV does not claim `search`.
- **SharePoint is modelled separately from OneDrive.** Their permission models
  differ; treating a document library as a personal drive is how site-level
  permissions get mistranslated.
- **NFSv4.2 has `copy_file_range`**, a genuine server-side copy. That is a
  statement about the protocol, not a performance claim.

### 4. Connector build order

Phased deliberately — ten simultaneous connectors means ten shallow ones.

| Phase | Provider | Why here |
|---|---|---|
| 1 | **S3-compatible** | Broadest reach; testable locally against MinIO with no OAuth |
| 2 | Google Drive | Highest demand; needs OAuth client + public webhook |
| 3 | OneDrive / SharePoint | Microsoft Graph; two permission models |
| 4 | Dropbox, Box, Egnyte | Similar OAuth shape once phase 2 exists |
| 5 | WebDAV, SFTP | Credential-based, no OAuth, narrower capabilities |
| 6 | SMB, NFS | Host-mounted, not user-configurable; evaluate before building |

Phase 1 first because it needs no OAuth application, no public callback URL and
no vendor review, so the contract suite and the sync engine can be proven before
OAuth complexity is added.

## Alternatives considered

**Copy everything into native storage on connect.** Rejected: it is a silent
egress bill, a duplication of the customer's data, and a compliance problem when
the file was never supposed to leave its jurisdiction.

**A single generic "cloud storage" adapter.** Rejected: the capability
differences above are not incidental. An abstraction that hides that S3 cannot
rename will produce a UI offering rename.

**Permission union rather than intersection.** Rejected outright — it is the
bug class this design exists to prevent.

## Security implications

The failure mode that matters is **a connected personal account silently
becoming visible to an entire organisation.** That is why `private` is the
default in the schema, not just in application code, and why the no-owner case
resolves closed.

Second failure mode: **credential swap.** Addressed in ADR-0005.

Third: **item-id enumeration.** `storage_items` keys on
`UNIQUE (connection_id, external_id)` rather than making the provider's id a
primary key — two providers will eventually collide on one id, and a shared key
space is a cross-connection read.

## Performance implications

`NOT MEASURED`. No connector exists. Sync strategy is designed around
provider change cursors rather than re-crawling, and `storage_sync_states`
exists to hold them, but no throughput or latency figure is claimed. Methodology
in ADR-0006.

## Migration implications

None. These tables are new in migration `0003` and nothing depends on them yet.
