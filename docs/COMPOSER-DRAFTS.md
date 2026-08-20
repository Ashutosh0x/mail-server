# Composer drafts

## Storage

A draft is a row in `messages` with `is_draft = 1` in the Drafts mailbox — not
a separate store. Recipients live in `message_recipients`, attachments in
`attachments` with `message_id` pointing at the draft.

Sending **moves** the row: `is_draft = 0`, mailbox becomes Sent, and a
server-generated `Message-ID` is written. Nothing is copied, so a draft cannot
diverge from the message it becomes.

## Autosave

Debounced at **800ms** after the last keystroke. Long enough that typing a
sentence is one request; short enough that a closed laptop loses almost
nothing.

The status line reflects the real result: `Saving…` while the request is in
flight, `Draft saved` only after the server confirms, and an error when it does
not. It never reports saved on the client's own say-so.

## Concurrency

`messages.version` increments on every save (migration `0005`). The client
sends the version it last read; a mismatch returns **409** carrying the
server's current copy, and the composer tells the user rather than
overwriting.

The rule: **never silently overwrite newer content.** Two tabs, a phone and a
laptop, or an autosave racing a manual save all resolve the same way — the
stale writer is told, and what the user has on screen is kept so nothing they
wrote is thrown away.

## Empty drafts

The composer creates a draft the moment it opens, so autosave has somewhere to
go. Closing without writing anything deletes it again — otherwise every
accidental Compose click leaves an empty shell in Drafts.

"Written anything" means a recipient, a subject, body text (tags with no text
do not count — an untouched editor often holds a stray `<br>`), or an
attachment.

## A bug worth recording

Draft creation runs in a `useEffect`. React StrictMode mounts, unmounts and
remounts in development, which created **two** drafts and orphaned one.

The naive fix — a ref guard — then broke Send entirely: refs survive
StrictMode's remount, so the second invocation skipped the request while the
first one's cleanup discarded its result, leaving `draftId` null forever and
Send permanently disabled.

The working shape: a ref guard prevents the duplicate request, and there is
deliberately **no cancellation**, so the single in-flight response is always
applied. Setting state after unmount is a no-op in React 18+, not a leak.

## Not built

- **No offline drafts.** A save attempted while offline fails and says so.
  There is no local queue, and claiming one without a sync path would risk
  losing work.
- **No draft list UI.** Drafts appear in the Drafts mailbox but cannot yet be
  reopened in the composer.
- **No cross-device presence.** Conflicts are detected on save; nothing
  reports that another device is currently editing.
