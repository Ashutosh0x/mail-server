# Storage

What the storage layer does today, and what it does not. The distinction
matters more than usual here, because a storage connector that half-works
loses data rather than showing an error.

## Vocabulary

| Term | Meaning |
|---|---|
| **Implemented** | Written, and exercised against a real counterparty |
| **Detected** | The host reports it; Mail Server reads that report |
| **Configured** | An operator set it up outside the app (a mount, an env var) |
| **Planned** | Not written. Nothing in the UI suggests otherwise |

---

## Status

| Capability | Status | Verified how |
|---|---|---|
| Cross-platform support | **See [cross-platform.md](cross-platform.md)** | Windows verified by hand; Linux and macOS by CI |
| Local filesystem storage | **Implemented** | 27 tests; atomic `.part` → rename, traversal refused |
| NFS storage *root* | **Implemented** | Mount verified via `statfs` magic `0x6969` and device-id boundary |
| Mounted-filesystem discovery | **Implemented** | Real volumes read from the OS; verified on Windows against a 511 GB disk |
| WebDAV connector | **Implemented** | 15 tests against a real WebDAV server: PROPFIND, MKCOL, PUT, GET, DELETE, MOVE, COPY, RFC 4331 quota |
| SSRF endpoint guard | **Implemented** | 31 tests, including DNS-resolution attacks and credential redaction |
| Storage cleanup | **Implemented** | 9 tests; ownership, partial failure, and blob-before-row ordering |
| SMB connector | **Planned** | Mounted shares are *detected*; connecting to an unmounted share is not built |
| S3-compatible connector | **Planned** | Needs SigV4 signing, unwritten and unverified |
| mDNS / SSDP discovery | **Planned** | Unmounted LAN devices are not discovered |
| File browser | **Implemented** | Breadcrumbs, sort, filter, upload with real progress, download, rename, delete, mkdir. Verified 11/11 through the UI against a real WebDAV server |
| Storage connections | **Implemented** | Probed before saving, so a failed connection leaves no row. 22 tests + 23/23 API checks |
| Connector contract | **Implemented** | One interface for every backend; the UI holds no provider-specific logic |
| Local directory connector | **Implemented** | 22 tests. Confinement checked twice — normalised, then re-checked after resolution to catch a symlink or junction |
| Attachment storage on an external provider | **Planned** | Roles are stored, but mail still uses the configured object-storage driver. Connecting storage must never silently redirect mail |

---

## Discovery

`GET /api/storage/discover` — authenticated, because the response maps the
host's storage including network shares and their servers.

Discovery is **server-side by necessity**. A browser cannot enumerate the
host's mounts or the local network, so any client-only implementation would be
displaying invented data.

What is read, per platform:

| Platform | Source | Notes |
|---|---|---|
| Linux | `/proc/mounts` | The kernel's own view; no external tool |
| Windows | `Win32_LogicalDisk` via PowerShell | Includes mapped network drives (`DriveType 4`) and removable media (`2`) |
| macOS / FreeBSD | `mount` | Type parsed from the parenthesised field |

Capacity comes from `statfs`, or from the volume record on Windows. **A mount
that cannot be measured reports `null`, and the UI shows "Capacity
unavailable".** It never shows `0 B` or an estimate.

Already-mounted network shares are reported with their protocol and remote
host, because to the operating system they are filesystems with a remote
source. An SMB share mounted at `/mnt/nas` appears as type `smb`.

### What discovery does not do

**Unmounted LAN devices are not found.** That needs mDNS/DNS-SD or SSDP,
neither of which is implemented. The capability report says so explicitly
(`mdns: false`, `ssdp: false`) so the UI can state it rather than showing an
empty list that looks like a broken scan.

**IP ranges are not scanned.** Deliberately. Range scanning is slow, hostile on
a shared network, and frequently indistinguishable from an attack.

---

## The endpoint guard

Any connector that takes a URL from a user and makes the *server* fetch it is
server-side request forgery by construction. The mail server is an unusually
good position to forge from: it sits inside the network, holds credentials, and
its outbound requests are trusted by what surrounds it.

`lib/server/storage/endpoint-guard.ts` refuses:

- protocols outside the connector's allow-list
- credentials embedded in the URL (they end up in logs)
- addresses in loopback, RFC 1918, link-local, CGNAT, multicast and reserved
  ranges — **checked after DNS resolution, not on the hostname**

That last point is the one that matters. An attacker controls DNS for their own
domain, so `storage.example.com` can resolve to `169.254.169.254`. Checking the
name proves nothing. If *any* resolved address is blocked, the endpoint is
refused — one public answer cannot launder a private one.

### Known residual risk

The guard resolves the name, then the HTTP client resolves it again. A DNS
record that changes between those two lookups is not covered — classic DNS
rebinding. Closing it needs the connection pinned to the address that was
checked, which means a custom agent per request. It is recorded here rather
than being quietly ignored.

### Credential redaction

`redact()` strips `Authorization` headers, presigned query parameters, labelled
secrets (`"secretAccessKey": "…"`, `password=…`) and `user:pass@host` URLs.
Every connector error passes through it before being stored, logged or
returned, because a failed request quotes the request — and the request carries
the credential.

---

## WebDAV

Implemented with `fetch`. WebDAV is HTTP, so a client library would be weight
for nothing.

| Operation | Method |
|---|---|
| List | `PROPFIND` with `Depth: 1` |
| Create folder | `MKCOL` |
| Upload | `PUT` (streamed) |
| Download | `GET` (returns the stream) |
| Delete | `DELETE` |
| Move / Copy | `MOVE` / `COPY` with `Destination` |
| Capacity | RFC 4331 `quota-available-bytes` / `quota-used-bytes` |

**HTTPS is required** unless `WEBDAV_ALLOW_INSECURE=true`. WebDAV authenticates
with Basic — a base64 of the password on *every request* — so plain HTTP means
the password in cleartext, repeatedly.

**Paths are confined to the configured root.** `..` segments are normalised and
the result checked against the root. Note the two behaviours, both correct:

- Root is `/`: `..` **clamps**. `/../../etc` becomes `/etc`, which is inside
  the share. The request is made and the server answers normally.
- Root is a subdirectory: `..` is **refused**, because it would reach a sibling
  the connection was never granted.

**Capacity is null when the server does not publish it.** Many WebDAV servers
do not implement RFC 4331; the honest answer is then "unavailable".

---

## Cleanup

`GET /api/account/storage/cleanup` reports what is using space; `POST` deletes.

Three rules the implementation is built around:

1. **Nothing is deleted without being named first.** Every destructive action
   is preceded by an inspection query the UI displays, so the confirmation
   names actual messages and actual sizes.
2. **Ownership is in the WHERE clause**, not a check beforehand. A separate
   "does this belong to you" query invites a race and a forgotten call site.
3. **A partial failure is reported as a partial failure.** Blob deletion can
   fail per file. The database row is removed only once its bytes are gone, so
   a failure leaves a still-listed attachment rather than an invisible orphan
   consuming quota forever.

Only **Trash** and **Spam** can be emptied wholesale. Emptying Inbox or Sent
from a settings page is not a cleanup tool.

`deleteOrphans` removes attachments with no message, older than one hour. They
are invisible in the interface and still count against quota. The grace period
exists because a file uploading right now also has no message yet.

---

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `SECRETS_KEY` | *(required)* | Seals stored provider credentials, AES-256-GCM with the row id as AAD |
| `OBJECT_STORAGE_DRIVER` | `filesystem` | `filesystem` or `nfs` |
| `OBJECT_STORAGE_ROOT` | `.data/objects` | Root for the local/NFS provider |
| `NFS_REQUIRE_NETWORK_FS` | `true` | Refuse to serve if the root is not a real network mount |
| `NFS_DEGRADED_ABOVE_MS` | `250` | Health probe latency above which the mount reports degraded |
| `STORAGE_ALLOW_PRIVATE_ENDPOINTS` | `false` | Permit connectors to reach RFC 1918 / loopback addresses. Needed for a NAS on your own LAN |
| `WEBDAV_ALLOW_INSECURE` | `false` | Permit `http://` WebDAV. Sends the password in cleartext on every request |

Both `_ALLOW_` flags are **server-side settings**. No request can ask for them.

---

## Credential storage

Provider credentials are sealed with AES-256-GCM, using the connection row's id
as additional authenticated data. A ciphertext copied into another row fails to
decrypt, which defeats swapping one tenant's mount onto another tenant's
credentials.

Credentials are never returned by any API, in any shape, including to the
account that created them.

---

## Deployment requirements

| To get | You need |
|---|---|
| Mounted-share detection | The share mounted on the host by the OS |
| NFS as the object-storage root | An OS-level NFS mount; the app does not mount |
| WebDAV over HTTPS | A valid certificate chain the server trusts |
| Connecting to LAN storage | `STORAGE_ALLOW_PRIVATE_ENDPOINTS=true` |

Mail Server does not mount filesystems. Mounting needs privileges the
application process does not hold and should not be given — an app that can
mount arbitrary remote filesystems as root is a much larger problem than the
convenience is worth.
