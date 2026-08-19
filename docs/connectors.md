# Storage connectors

**No connector exists yet.** Every external provider is `status: "planned"`,
`availableProviders()` returns `[]`, and a test asserts that emptiness. This
page describes the contract the first one will be built to.

Design rationale is in [ADR-0004](adr/0004-external-storage-federation.md);
credential handling in [ADR-0005](adr/0005-provider-credential-security.md).

## The registry

`packages/types/src/providers.ts` names fourteen providers. Being listed is not
a claim that anything works.

| Provider | Status | Auth | Notable capability gaps |
|---|---|---|---|
| `native` | **available** | none | — (this is our own storage) |
| `s3` | planned | access key | No `rename`, no `move` — S3 has neither |
| `gcs` | planned | access key | Same shape as S3 |
| `azure_blob` | planned | access key | Same shape as S3 |
| `google_drive` | planned | OAuth 2 | Full-featured; needs a public webhook |
| `onedrive` | planned | OAuth 2 | Microsoft Graph |
| `sharepoint` | planned | OAuth 2 | Modelled separately from OneDrive |
| `dropbox` | planned | OAuth 2 | — |
| `box` | planned | OAuth 2 | — |
| `egnyte` | planned | OAuth 2 | Egnyte's own Workspace integration is Legacy |
| `webdav` | planned | password | No `search` — RFC 5323 `SEARCH` is optional |
| `sftp` | planned | SSH key | No search, versioning, sharing or thumbnails |
| `smb` | planned | password | Server-side mount only, never from a browser |
| `nfs` | planned | mount | Has `server_side_copy` via NFSv4.2 `copy_file_range` |

**Capabilities describe the provider, not our connector.** They are checked
against each vendor's own API documentation. A connector declaring more than it
implements is the bug this table exists to prevent — which is why a capability
being present does not make an operation available, and why
`applicableOperations()` derives the required test set from the descriptor.

Three entries are worth understanding, because each is a place a naive
implementation goes wrong:

- **S3 cannot rename or move.** A rename is a server-side copy followed by a
  delete. The registry omits both capabilities, so no UI offers them, and
  `move` will be claimed only when the connector performs both halves
  atomically enough to be honest about it.
- **WebDAV does not claim search.** RFC 5323's `SEARCH` method is optional and
  rarely implemented; claiming it would break against most servers.
- **SharePoint is not OneDrive.** Their permission models differ, and treating a
  document library as a personal drive is how site-level permissions get
  mistranslated into user-level ones.

## The contract

Defined in `packages/types/src/connector.ts`, covered by 11 tests.

### Required of every connector

No connector may skip these, whatever the provider.

| Group | Operations |
|---|---|
| Lifecycle | `connect` · `authenticate` · `validateConnection` · `reconnect` · `disconnect` |
| Reading | `list` · `metadata` · `download` |
| Failure behaviour | `rateLimit` · `providerFailure` · `permissionDenied` · `expiredCredentials` |

The failure-behaviour four are required deliberately. A connector never tested
against a 429 or an expired refresh token will meet both for the first time in
production, on a customer's account, and the observable result is a mount that
appears empty rather than one that reports it is broken.

### Capability-gated

Required only where the descriptor declares the capability:

| Operation | Needs capability |
|---|---|
| `search` | `search` |
| `upload` | `write` |
| `rename` | `rename` |
| `move` | `move` |
| `delete` | `delete` |
| `createFolder` | `folders` |
| `share` | `sharing` |

A provider that genuinely lacks a capability is **skipped and recorded as
skipped** — never counted as passing. A report where "skipped" and "passed" are
the same colour is how a connector ships with half its operations missing.

### Promotion gate

`meetsContract(descriptor, results)` is the machine-checkable half of the
eight-point gate in ADR-0004. It is strict on purpose:

- An operation with **no result at all** counts as missing. Silence is the most
  common way a gap reaches production.
- A **required** operation reported as `skipped` counts as missing —
  `applicableOperations()` only returns operations the provider claims.
- Results for operations the provider never claimed are ignored rather than
  treated as credit.

There is no status meaning "not implemented but probably fine."

## Building a connector

1. Implement `StorageConnector` for the provider.
2. Map the provider's own permissions into `ProviderGrant`. **Never widen**:
   `grantFor()` feeds `effectiveAccess()` as its third and final layer, and that
   layer may only remove access.
3. Store credentials through `sealSecret()` with `connection:<row id>` as the
   context. Never a raw secret, never in a response, never in a log.
4. Run the contract suite. Fix, do not skip.
5. Run the benchmark scenarios in `benchmarks/external-storage/` and commit the
   results with their conditions (ADR-0006).
6. Only then flip `status` to `"available"` — which will make
   `storage.spec.ts`'s emptiness assertion fail, and that failure is the signal
   to review, not to delete the test.

## What a connector must never do

- Report a connection as active when authentication has not been proven.
- Return an empty listing to hide an error. An unreachable provider is
  `unreachable`, not empty.
- Delete provider-side data when our reference row is removed. Deleting a
  federated item removes **our reference**, never the customer's file.
- Cache a credential outside `storage_connections.encrypted_credentials`.
- Expose a provider token to the browser.
