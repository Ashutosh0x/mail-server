# ADR-0008 — Storage provider architecture

**Status:** Accepted, 2026-08-20. `filesystem` and `nfs` implemented; `s3`
planned.

## Context

Object bytes had one implementation — a filesystem adapter with four methods —
sitting directly behind attachment upload and download. Three pressures made
that insufficient:

1. **Drive** would need ranges, moves, copies and stats, none of which existed.
2. **NFS** was the intended production backend, and NFS fails in ways local
   disk does not.
3. **Health** was unobservable. Nothing could answer "is storage working right
   now" without uploading a file and seeing what happened.

The specific failure that shaped this decision: **an unmounted NFS export is
usually still a valid empty local directory at the same path.** Writes succeed,
`stat` succeeds, and a naive health check reports green — while data lands on
the wrong disk, invisible to other nodes and absent from backups. A storage
layer that cannot detect this is not production-ready regardless of how correct
its I/O is.

## Decision

**One `StorageProvider` interface; NFS as a subclass of the filesystem
provider; health checks that perform real I/O.**

### 1. The interface is the seam

`put` · `get` · `getRange` · `delete` · `exists` · `stat` · `move` · `copy` ·
`healthCheck`.

Mail attachments and any future Drive never learn whether bytes are on local
disk, an NFS export or an object store. The provider, in return, never reads
the database and never applies an authorization rule — by the time a call
arrives, the caller has established that this user may touch this object.

That boundary is the point. A permission check inside a driver means two
drivers eventually enforce subtly different rules, and the weaker one becomes
the vulnerability.

### 2. NFS extends filesystem rather than reimplementing it

From Node's perspective an NFS export **is a directory**. Duplicating the I/O
paths would mean two implementations of atomic write, path-escape refusal and
streaming — and two chances to get each wrong. `NfsStorage` inherits all of it
and adds only what is genuinely different:

- **Mount verification**, via two independent signals: the `statfs` filesystem
  magic number (NFS is `0x6969`) and the device-id boundary between the root
  and its parent.
- **`ESTALE` as a backend fault**, never as absence.
- **A latency threshold** that reports `degraded` rather than leaving slowness
  to be discovered by users.

Where the platform reports neither signal — Windows returns type `0` and gives
no comparable `st_dev` guarantee — the state is `unknown`, never `healthy`.

### 3. Missing is not unreachable

`ObjectNotFoundError` and `StorageUnavailableError` are distinct types, and
thirteen POSIX codes map to the latter. "Your file is gone" and "we cannot
reach the disk right now" demand opposite reactions from a user, and
collapsing them is how a network blip gets reported as data loss — possibly
prompting a restore over data that was fine.

### 4. Health checks do real I/O, uncached

Write a probe, read it back, compare, delete, time it. Capacity from `statfs`,
never from configuration. No cached "last known good" result: a health endpoint
that serves a stale success is worse than a slow one, because the entire point
is noticing an outage that started thirty seconds ago.

`unknown` is the default state, so a field that has never been probed cannot
report green.

### 5. Writes are atomic

Write to `<key>.<uuid>.part`, then `rename` into place. A reader never sees a
half-written object, and a crash leaves a `.part` file for a future reconciler
rather than a truncated file that looks complete.

## Alternatives considered

**Keep one filesystem adapter and configure a path at NFS.** This is what most
projects do, and it is exactly the design that cannot detect an unmounted
export. Rejected on that basis alone.

**A third-party storage abstraction library.** Rejected. The interface is nine
methods, the value is in the NFS-specific semantics no general library models,
and this repository already carries eight declared dependencies that nothing
imports.

**Object storage (S3/MinIO) instead of NFS.** Better for horizontal scaling and
the likely eventual answer — the interface exists partly to make that swap
cheap. Not chosen now because it is a heavier operational dependency than a
mount, and no connector has been written. Recorded as `PLANNED` rather than
implied.

**Run PostgreSQL on NFS too.** Explicitly rejected. NFS locking semantics and
fsync behaviour are a known hazard for database workloads. Bytes on NFS,
database on storage suited to database I/O.

## Security implications

The browser never receives a mount path, a storage key, a provider name or a
filesystem type. The health endpoint is admin-only and returns `404` rather
than `403` for a non-admin, so it does not confirm that this deployment has an
admin surface worth probing.

Storage keys are generated, never derived from user input, and every path
resolution is checked against the root regardless — it costs one string
comparison and it is the last line before the filesystem.

Not addressed here: object bytes are **not** encrypted at rest beyond whatever
the volume provides, and nothing scans uploads for malware.

## Performance implications

`NOT MEASURED` in the sense of ADR-0006 — no benchmark has been run. Two real
measurements exist from the health probe on the development machine, recorded
as observations rather than as benchmarks: a write-read-delete round trip on
local NTFS took **14.19ms**, and `statfs` reported 511GB total with 22GB
available. Neither is a benchmark of throughput under load.

## Migration implications

`lib/server/storage.ts` was replaced by `lib/server/storage/`. Both existing
callers import `storage()` and `newStorageKey()`, which are re-exported
unchanged, so no call site changed. Storage keys keep their existing format,
so no data moves.

## Testing note

Adding tests surfaced a recurring problem: `server-only` throws on import under
Vitest, and this repository had twice responded by **deleting the import** from
the module under test — trading a real safety property for test convenience.
That is now fixed properly with a Vitest alias to a stub, so the guard stays in
the source and protects the build while the modules it guards remain testable.
