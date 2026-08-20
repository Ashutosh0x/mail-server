# Storage

## Status: not implemented on Android

The backend is real and substantial — this is a client gap, not a missing
feature.

## What the server already provides

| Endpoint | Purpose |
|---|---|
| `GET /api/system/capabilities` | What **this host** can actually do |
| `GET /api/account/storage` | Quota and usage |
| `GET /api/account/storage/cleanup` | What is taking up space |
| `POST /api/account/storage/cleanup` | Delete permanently; reports failures |
| `GET /api/storage/discover` | Storage the server can see |
| `GET` / `POST /api/storage/connections` | List and connect |
| `GET /api/storage/connections/{id}/files` | Browse |
| `GET /api/storage/connections/{id}/content` | Read a file |

## The capability rule

`/api/system/capabilities` exists precisely so the frontend stops guessing, and
the Android client must read it rather than hardcode a provider list.

Its answers on a typical host:

| Provider | Available | Why |
|---|---|---|
| Local filesystem | always | the default object store |
| WebDAV | yes | implemented and tested against a real server |
| Mounted filesystems | host-dependent | needs a discovery adapter for the platform |
| Local connections | operator-dependent | only where `STORAGE_LOCAL_ROOTS` permits a path |
| SMB/CIFS | **no** | no client library. Mounted shares still work via `mounted` |
| NFS | **no** | mounting needs privileges the app process does not hold |
| S3 | **no** | request signing has not been written or verified |

**`smb: false` on Windows is correct** and not a bug: the host can mount SMB
shares and Mail Server can use them once mounted, but it has no SMB client of
its own.

§19 forbids showing providers the backend cannot support, and forbids fake
"connected" entries. Reading this endpoint is how the Android UI obeys both —
never a hardcoded list, which would be wrong on some platform every time.

## Connection flow, when built

```
tap provider → setup form → server PROBES → save → browse
```

The server probes **before** storing, so a failed connection leaves no record
and the list never shows a connection that has never worked. The client must not
add an optimistic entry ahead of the probe result.

## The file browser, when built

Folders, files, sort, upload, download, move, copy, rename, delete, create
folder — with breadcrumbs and a clear hierarchy rather than the desktop's
two-pane layout.

Gestures follow the mail list's rules (`gestures.md`): swipe reveals then
activates, long-press selects, and every gesture has a menu equivalent.

## Deletion honesty

`POST /api/account/storage/cleanup` returns what was **actually** removed, with
`failures` populated on a partial failure and fresh totals attached.

The client must render a partial failure as one. Same rule the mail actions
follow with `changed` vs `requested`, and the same reason: rounding a partial
result up to success tells the user space was freed that was not.

## SSRF

Connection targets are validated server-side. `STORAGE_ALLOW_PRIVATE_ENDPOINTS`
and `WEBDAV_ALLOW_INSECURE` default **off** in production and exist so local
development can reach a loopback test server.

The Android client adds no validation of its own, and must not: a second opinion
about which hosts are reachable would either contradict the server or provide
false assurance. The server is the boundary.
