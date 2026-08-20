# Composer attachments

## Lifecycle

```
  pick or drop
      ↓
  POST /api/attachments/upload      body IS the file; name in a header
      ↓
  streamed to storage               capped mid-stream, never buffered whole
      ↓
  magic-byte type detection         the browser's claim is recorded, not trusted
      ↓
  attachments row, message_id NULL
      ↓
  draft save                        binds the id to the draft, scoped by user
      ↓
  send                              read back and base64-encoded into the MIME
```

An attachment is only "Attached" once the server has stored it and returned an
id. Progress comes from `XMLHttpRequest.upload.onprogress` — actual bytes on
the wire, never a timer pretending to be one. `fetch` still has no
upload-progress event, which is why the client uses XHR here and nowhere else.

## States

Every state maps to something real:

| State | Means |
|---|---|
| Uploading + % | Bytes actually transferred |
| Attached | The server stored it and returned an id |
| Failed + Retry | The request failed; the `File` is kept so retry needs no re-pick |
| Removed | Cancels an in-flight upload through `AbortController` |

A file over the limit is marked failed **before** uploading, rather than after
the user waits for a 100MB transfer to be rejected.

## Limits

From `GET /api/config`, never hardcoded in the UI:

- `MAX_ATTACHMENT_SIZE_BYTES` — per file, default 100MB
- `MAX_OUTBOUND_MESSAGE_SIZE_BYTES` — total, default 18MB, because base64
  inflates by ~37% and that lands near the common 25MB receiver cap

Both are re-enforced server-side. The composer warns when the total exceeds the
outbound limit rather than letting the send fail unexplained.

## A race worth recording

`addFiles` added an item and then **synchronously** started its upload, whose
first progress write read the item list from a ref that had not been refreshed
yet — so it overwrote the pending addition with the previous, empty array. The
attachment appeared for one frame and vanished.

The whole panel now uses **functional state updates** (`setItems(current => …)`)
rather than reading a ref. Every mutation composes against the current value,
and the race becomes unrepresentable.

It cost a long debugging session because every individual piece looked correct:
the handler fired, the props were right, the endpoint returned 201. Only
tracing the panel's renders — always `items = 0` — showed the update being
discarded immediately after being applied.

## Not built

- **No resumable or chunked upload.** One streamed request; a failure at 90%
  restarts from zero.
- **No malware scanning.** Type-checked, not scanned.
- **No Drive picker.** No Drive backend exists, so no button offers one.
- **No inline images.** The MIME layer supports `cid:` parts and the sanitiser
  permits them; the editor has no insertion path.
- **No orphan cleanup.** An attachment uploaded to an abandoned draft stays in
  storage.
