# Storage architecture

How bytes are stored, and where the boundaries are.

Status vocabulary follows [architecture-status.md](architecture-status.md).
Decision rationale is in [ADR-0008](adr/0008-storage-provider-architecture.md).

## The one rule

**The database owns metadata. The provider owns bytes.**

A storage provider never reads the database and never applies an authorization
rule. By the time a call reaches a provider, the caller has already established
that this user may touch this object. Putting a permission check inside a
driver means two drivers eventually enforce subtly different rules, and the
weaker one becomes the vulnerability.

```
  Browser
     │  never sees a mount path, a storage key, or a provider name
     ▼
  API route ──── requireUser() ──── ownership check
     │
     ▼
  Storage service          keys, quotas, accounting
     │
     ▼
  StorageProvider          put · get · getRange · delete · stat · move · copy
     │                     healthCheck
     ▼
  filesystem │ nfs │ (s3: PLANNED)
```

## Providers

| Provider | Status | Use |
|---|---|---|
| `filesystem` | **IMPLEMENTED** | Local disk. Development and single-node installs |
| `nfs` | **IMPLEMENTED** | A mounted NFS export, with mount verification |
| `s3` | `PLANNED` | No provider exists. Setting the driver throws at startup |

Selected by `OBJECT_STORAGE_DRIVER`. An unimplemented value **throws on first
use** rather than falling back to local disk — a silent fallback is how
attachments end up on one node and 404 from every other one, discovered days
later as missing files.

## Why NFS is a subclass, not a rewrite

From Node's perspective an NFS export **is a directory**. The I/O paths are
identical, so `NfsStorage` inherits all of them from `FilesystemStorage`. What
is genuinely different is operational, and that is all the subclass adds.

### 1. Mount verification — the failure that matters most

An unmounted NFS path is usually still a perfectly valid **empty local
directory at the same location**. Writes succeed. `stat` succeeds. A naive
health check reports green. Meanwhile customer data is landing on the wrong
disk, invisible to every other node and absent from every backup.

Two independent signals catch it:

- **Filesystem type.** Linux `statfs` reports a magic number; NFS is `0x6969`.
  If the root reports a local filesystem, nothing is mounted.
- **Mount boundary.** A mount point has a different device id (`st_dev`) from
  its parent directory. If they match, nothing is mounted there.

Where the platform reports neither — **Windows returns type `0` and does not
give a comparable `st_dev` guarantee** — the state is `unknown`, never
`healthy`. Verified in this environment: the NFS provider on Windows reports

```
state:   unknown
detail:  This platform (win32) does not report filesystem type or mount
         boundaries, so NFS cannot be confirmed. Read and write probes
         succeeded, but the backend is unverified.
```

That is the honest answer. Reporting `healthy` from an absence of evidence is
the bug this design exists to prevent.

### 2. Stale handles

`ESTALE` means the export was re-created, or a file was replaced underneath an
open handle. It is a **backend fault**, never "the file was deleted". Treating
it as `ENOENT` would report a live file as missing — and might prompt someone
to restore from backup over data that was fine.

The full set treated as backend faults rather than absence: `ESTALE`,
`ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `EHOSTDOWN`, `EHOSTUNREACH`,
`ENETDOWN`, `ENETUNREACH`, `EIO`, `EREMOTEIO`, `ENODEV`, `EBUSY`, `EAGAIN`.

### 3. Latency expectations

A local probe completes in single-digit milliseconds. A healthy NFS round trip
is slower; a badly degraded one is much slower while still technically working.
`NFS_DEGRADED_ABOVE_MS` (default 250) turns that into a reported `degraded`
state instead of a mystery.

**The application never mounts anything.** Mounting is the operator's job, via
fstab or the container runtime. An application that mounts its own filesystems
needs privileges it should never hold.

## Health checks are real

Every call to `healthCheck()` performs actual I/O:

1. Write a small probe object
2. Read it back and compare the content
3. Delete it
4. Record the round-trip time

Capacity comes from `statfs`, not from configuration. Measured here:

```
totalBytes      511041335296     (from statfs, not configured)
availableBytes   22176104448     bavail — space available to an unprivileged
                                 process, which is what this app is. bfree
                                 would include root's reserve and overstate it
latencyMs              14.19     a real write-read-delete round trip
```

There is **no cached "last known good" result**. A health endpoint that serves
a stale success is worse than one that is slow, because the entire point is to
notice an outage that started thirty seconds ago.

States: `healthy` · `degraded` (readable, not writable, or slow) ·
`unavailable` · `unknown` (never probed, or the platform cannot answer).
`unknown` is the default, so a field that has never been checked cannot report
green.

## Writes are atomic

```
write to  <key>.<uuid>.part
          ↓
rename to <key>          atomic within a filesystem
```

A reader never observes a half-written object. A crash mid-upload leaves a
`.part` file for the reconciler rather than a truncated file that looks
complete. On failure the temporary file is removed, so a partial upload never
appears under the real key — asserted by a test that destroys the source
stream mid-write.

`move()` falls back to copy-then-delete on `EXDEV` (the two paths are on
different filesystems), which is a correct outcome rather than a failure.

## Storage keys

Keys are **generated, never derived from user input**:

```
<userId>/<2 hex>/<2 hex>/<uuid>
```

Deriving a key from a filename is how `../../etc/passwd` becomes a write path.
The original filename lives in the database as data. Two levels of fan-out keep
directories small — a single directory holding a million files is slow to list
and slow to open on most filesystems, NFS especially.

Every path resolution is checked against the root regardless, because it costs
one string comparison and it is the last line before the filesystem.

## Not built

Named rather than implied:

- **No S3 provider.** The interface is ready; nothing implements it.
- **No malware scanning.** Attachments are type-checked by magic bytes but not
  scanned. There is no ClamAV in this environment.
- **No reconciliation job.** Orphaned `.part` files and database/storage drift
  are detectable by design but nothing sweeps for them yet.
- **No Drive.** The provider layer is the foundation a Drive product would sit
  on; the product itself does not exist.
- **No encryption at rest** beyond whatever the underlying volume provides.
  Provider credentials are encrypted ([ADR-0005](adr/0005-provider-credential-security.md));
  object bytes are not.
- **No real NFS export has ever been mounted.** There is no container runtime
  in the development environment, so the NFS provider is verified by unit tests
  against a real temporary directory and by its behaviour on Windows — not
  against an actual NFS server.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `OBJECT_STORAGE_DRIVER` | `filesystem` | `filesystem` · `nfs`. Anything else throws |
| `OBJECT_STORAGE_ROOT` | `.data/blobs` | Storage root, or the NFS mount path |
| `NFS_REQUIRE_NETWORK_FS` | `true` | Refuse to serve when the root is plainly local |
| `NFS_DEGRADED_ABOVE_MS` | `250` | Probe round trip above this reports degraded |

Set `NFS_REQUIRE_NETWORK_FS=false` only to run the NFS provider against local
storage deliberately, such as in a test.

## Operating an NFS deployment

Not implemented here, and stated as requirements rather than as done work:

- Export to **specific private subnets**, never `*`. NFS must not be reachable
  from the internet.
- Prefer **NFSv4.x** — one port, integrated ACLs, and `RPCSEC_GSS`/Kerberos
  where the deployment warrants it.
- Enable **root squashing**, so compromising the application does not become
  unrestricted storage-server root.
- Run the application as a **dedicated non-root user**.
- **NFS is not a backup.** Snapshots and off-host copies are separate work.
