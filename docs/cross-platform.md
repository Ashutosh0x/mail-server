# Cross-platform support

One codebase, one UI, one storage abstraction, running on Windows, Linux and
macOS. Platform differences live behind adapters; product code never asks which
operating system it is on.

## What "supported" means here

The word is used precisely, because it is the whole point of this document.

| Label | Meaning |
|---|---|
| **Verified** | Exercised on that platform, by CI or by hand, with the result recorded |
| **Implemented** | The code exists and is platform-independent, but has not run there yet |
| **Not built** | Absent. The UI says so rather than offering it |
| **Host-dependent** | Works only if the operating system provides it — the app does not |

A green typecheck is not verification. `docs` claiming a platform works because
the code compiles is exactly the failure this file exists to prevent.

---

## Current verification status

| Platform | Architecture | Status |
|---|---|---|
| Windows 11 | x64 | **Verified by hand** — storage discovery against a real 511 GB volume, WebDAV connect/browse/transfer, full test suite, production build |
| Linux | x64 | **Verified by CI** — typecheck, 401 tests, build on `ubuntu-latest` |
| macOS | arm64 (Apple Silicon) | **Verified by CI** — same pipeline on `macos-latest` |
| Windows | arm64 | **Not verified.** No runner. Nothing in the dependency tree is known to be x64-only, but that is an expectation, not a result |
| Linux | arm64 | **Not verified.** No runner |
| macOS | x64 (Intel) | **Not verified.** GitHub's `macos-latest` is Apple Silicon |

CI runs the same `typecheck → test → build` on all three runners, with
`fail-fast: false` so a Windows-only break is visible rather than masking the
other two. `turbo test --force` is deliberate: turbo's cache is keyed on
inputs, not on the operating system, so a cached pass from Linux would
otherwise make the Windows job green without running anything.

---

## The platform layer

`apps/web/lib/server/platform/platform.ts` is the only module that reads
`process.platform`. A CI job fails the build if another one appears.

That rule is not tidiness. Scattered `process.platform === "win32"` checks are
how one codebase quietly becomes three: each is a small decision made in
isolation, and they drift until the platforms behave differently for reasons
nobody chose.

Node's identifiers are normalised on the way in, so product code never sees
`win32` or `darwin`:

| Node | Product |
|---|---|
| `win32` | `windows` |
| `linux` | `linux` |
| `darwin` | `macos` |
| anything else | `unsupported` |

---

## Data directories

Each platform has a convention, and following it is not cosmetic. On Windows,
writing to the install directory breaks under UAC. On macOS, a config file in
`~/.config` is invisible to every tool a Mac user owns.

| | Windows | macOS | Linux |
|---|---|---|---|
| Data | `%LOCALAPPDATA%\MailServer` | `~/Library/Application Support/MailServer` | `$XDG_DATA_HOME/MailServer` |
| Config | `…\MailServer\config` | `…/MailServer/config` | `$XDG_CONFIG_HOME/MailServer` |
| Logs | `…\MailServer\logs` | `~/Library/Logs/MailServer` | `$XDG_STATE_HOME/MailServer/logs` |
| Storage | `…\MailServer\storage` | `…/MailServer/storage` | `$XDG_DATA_HOME/MailServer/storage` |
| Temp | `os.tmpdir()` | `os.tmpdir()` | `os.tmpdir()` |

`LOCALAPPDATA` rather than `APPDATA` on Windows: this is machine-local state,
and it should not follow a roaming profile between machines.

Every one is overridable, because a container, a service account and a
developer want different answers and none of them should patch code:

```
MAILSERVER_DATA_DIR
MAILSERVER_CONFIG_DIR
MAILSERVER_LOG_DIR
MAILSERVER_STORAGE_DIR
MAILSERVER_CACHE_DIR
MAILSERVER_TEMP_DIR
```

---

## Path handling

Paths are never concatenated by hand. `node:path` decides separators, and the
list separator for environment variables comes from the platform layer — `;` on
Windows and `:` elsewhere, matching how `PATH` is written. Splitting a Windows
path list on a colon would cut `C:\data` in half.

User-supplied paths are normalised, refused on `..` rather than clamped, and
then checked again after resolution. The second check is what catches a symlink
or a Windows junction: `/root/link` is inside the root as a string and
`/etc/shadow` after resolution. Verified with a real junction on Windows.

---

## Storage support matrix

| Feature | Windows | Linux | macOS |
|---|---|---|---|
| Local filesystem | **Verified** | Implemented | Implemented |
| Mounted filesystem detection | **Verified** | Implemented | Implemented |
| Local storage connections | **Verified** | Implemented | Implemented |
| WebDAV connector | **Verified** | Implemented | Implemented |
| SMB share, already mounted | Host-dependent | Host-dependent | Host-dependent |
| **Direct SMB** | Not built | Not built | Not built |
| NFS export, already mounted | Host-dependent | Host-dependent | Host-dependent |
| **Direct NFS mounting** | Not built | Not built | Not built |
| S3-compatible | Not built | Not built | Not built |
| mDNS / SSDP discovery | Not built | Not built | Not built |

"Host-dependent" is the honest label for mounted network shares. Once the
operating system has mounted an SMB share or an NFS export, it is a directory,
and the local connector uses it like any other. Mail Server does not mount
anything: mounting needs privileges the application process does not hold and
should not be given.

WebDAV is marked Implemented rather than Verified on Linux and macOS because
its tests run in CI on those platforms, but nobody has pointed it at a real NAS
there. The tests do run against a real WebDAV server the suite starts, so the
protocol handling is exercised — just not against third-party servers.

### How each platform is discovered

| Platform | Source | Notes |
|---|---|---|
| Linux | `/proc/mounts` | The kernel's own view; no external tool |
| Windows | `Win32_LogicalDisk` via PowerShell | Includes mapped network drives (`DriveType 4`) and removable media (`2`) |
| macOS | `mount` | Type read from the parenthesised field |

Windows is the one platform that shells out, and it is isolated inside the
Windows adapter. `Get-Volume` alone does not report mapped network drives,
which is exactly the case that matters for a NAS.

---

## Error handling

Operating systems report the same problem differently — `EACCES` on POSIX,
`EPERM` or "Access is denied" on Windows. Both map to one product category so
the UI learns one vocabulary:

| Category | HTTP | Example causes |
|---|---|---|
| `not_found` | 404 | `ENOENT`, `ENOTDIR` |
| `permission_denied` | 403 | `EACCES`, `EPERM`, "Access is denied" |
| `read_only` | 403 | `EROFS` |
| `busy` | 502 | `EBUSY`, "being used by another process" |
| `unavailable` | 502 | `ENODEV`, `ESTALE`, "network path was not found" |
| `out_of_space` | 507 | `ENOSPC`, `EDQUOT` |
| `timeout` | 502 | `ETIMEDOUT` |

The raw code is kept for the server log and never reaches the client — a raw
error usually carries the full server path, which is unhelpful to the reader
and a small information leak to everyone else.

---

## Capability reporting

`GET /api/system/capabilities` reports what **this** host can do. The frontend
reads it rather than assuming, because every hardcoded assumption is wrong
somewhere: SMB offered where no client exists, a local-storage button where the
operator never permitted a root, discovery looking broken rather than
unimplemented.

Each flag is derived from something real — a connector that exists, an
environment variable that is set, an adapter for this platform — never from the
platform name. `smb: false` on Windows is correct: the host can mount SMB
shares and Mail Server can use them once mounted, but it has no SMB client of
its own.

Example, from the Windows machine this was developed on:

```json
{
  "platform": "windows",
  "architecture": "x64",
  "storage": {
    "local": true, "mounted": true, "localConnections": true,
    "webdav": true, "smb": false, "nfs": false, "s3": false,
    "networkDiscovery": false
  }
}
```

---

## Development

`npm install`, `npm test` and `npm run dev` work on all three platforms with no
shell utilities beyond Node. The one exception is the Windows discovery
adapter's PowerShell call, which only runs on Windows.

Scripts avoid `bash`, `sed`, `grep`, `rm` and friends. The CI guard job uses
`grep`, but it runs only on `ubuntu-latest` where it is guaranteed present.

---

## Known gaps

**No migration runner for SQLite development databases.** The dev schema is
applied with `CREATE TABLE IF NOT EXISTS`, which never adds a column to an
existing table, so a database created before a schema change silently lacks the
new columns. This bit during development of the storage connectors. Production
PostgreSQL has a real migration runner with checksum drift detection; SQLite
development does not.

**Windows ARM64, Linux ARM64 and Intel macOS are unverified.** No runners. They
are absent from the verified column rather than assumed to work.

**Service management is not implemented.** There is no `MailEngineRuntime` with
Windows/launchd/systemd adapters, because Stalwart has never been executed —
building service adapters for a process that has never started would be
scaffolding, not integration.

**Docker deployment is unverified.** Docker is not installed on the development
machine, so the Compose file's cross-platform volume behaviour has never been
executed. The file says so in a header comment.
