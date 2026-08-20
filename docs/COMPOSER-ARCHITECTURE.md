# Composer architecture

How a message goes from an empty composer to bytes on an SMTP connection.

## The pipeline

```
  Composer (client)
     │  recipients · subject · rich text · attachments
     ▼
  PUT /api/drafts/:id            sanitise HTML · validate addresses · version check
     │
     ▼
  messages row (is_draft = 1)    the draft IS a message, not a parallel store
     │
     ▼
  POST /api/drafts/:id/send      authorise From · validate · idempotency
     │
     ▼
  MIME construction              RFC 5322, ours (lib/server/mime.ts)
     │
     ▼
  outbound_queue row             durable. `queued` is a real state
     │
     ▼
  SMTP (nodemailer as client)    `sent` only when a server accepts it
```

## Files

| File | Responsibility |
|---|---|
| `components/compose/composer.tsx` | Shell: state, autosave, send states, close semantics |
| `components/compose/recipient-field.tsx` | Chips, parsing, suggestions, keyboard model |
| `components/compose/editor.tsx` | Rich text, toolbar, link insertion |
| `components/compose/attachments.tsx` | Upload lifecycle, progress, retry, drag-drop |
| `lib/server/compose.ts` | Drafts, send pipeline, recent recipients |
| `lib/server/mime.ts` | RFC 5322 construction |
| `lib/server/sanitize.ts` | HTML policy |
| `lib/server/transport.ts` | SMTP delivery |

## A draft is a message

`is_draft = 1` in the Drafts mailbox. Sending **moves** the row rather than
copying it: an attachment already uploaded against the draft needs no second
copy, and a draft cannot diverge from the message it becomes.

The composer creates a draft the moment it opens, so autosave has somewhere to
go. Closing without writing anything deletes it again — otherwise every
accidental Compose click leaves an empty shell in Drafts.

## Where each value comes from

Nothing dynamic is hardcoded.

| Shown | Source |
|---|---|
| From addresses | `users.email` plus enabled rows in `aliases`, server-side |
| Recipient suggestions | The caller's own sent mail. No contact store exists |
| Attachment size limit | `GET /api/config` → `MAX_ATTACHMENT_SIZE_BYTES` |
| Outbound size limit | `GET /api/config` → `MAX_OUTBOUND_MESSAGE_SIZE_BYTES` |
| Draft saved state | The version the server returned |
| Send state | The queue row's real status |
| Upload progress | `XMLHttpRequest.upload.onprogress` — actual bytes |

## The editor: why not TipTap or Lexical

`contentEditable` with `document.execCommand`, deliberately.

The formatting a mail composer needs is small and closed — bold, italic,
underline, strike, lists, quote, code, link, clear — and that is exactly
execCommand's competence. The alternative is 30–100KB of runtime for a document
model this feature set does not need, in a repository that already carries
eight declared dependencies nothing imports.

execCommand is deprecated but is not going away: every major webmail still
relies on it, and no browser has signalled removal.

**The honest cost**, recorded rather than glossed: output varies between
engines, and there is no document model, so tables, collaborative editing and
reliable undo grouping would each need a real editor. If the composer grows
those requirements the answer is to migrate, not to keep patching.

## Dependencies added, and why

| Package | Justification |
|---|---|
| `nodemailer` | SMTP client only. It never builds our MIME — it is handed the raw message, so the RFC 5322 output and its injection defences stay ours and stay tested |
| `sanitize-html` | Security-critical parsing. The bypass surface (mXSS, parser mutation, namespace confusion) makes a hand-rolled sanitiser a vulnerability you have not found yet. The value we add is the **policy**, not the parser |

Both follow the same rule applied to `@simplewebauthn`: delegate where the hard
part is adversarial parsing or cryptography; keep the part that expresses our
own trust model.

## Not built

Named plainly rather than implied by absence:

- **Drive picker.** No Drive backend exists, so no button offers one.
- **AI writing.** No AI backend exists, so no panel offers it.
- **Resumable/chunked upload.** Uploads are a single streamed request. A
  100MB upload that fails restarts.
- **Inline images.** The MIME layer supports `cid:` parts and the sanitiser
  permits them; the editor has no insertion path.
- **Scheduled send and undo-send.** No scheduler.
- **Signatures.** No settings surface for them.
- **Reply and forward.** The send pipeline carries `inReplyTo` and
  `references`, so the data model is ready; no UI enters that mode.
- **Offline queueing.** A draft saved while offline fails to save and says so.
- **Delivery worker.** Delivery runs inline on the send request. Fine for one
  message, wrong for a queue under load.
