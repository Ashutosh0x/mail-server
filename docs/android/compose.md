# Compose

Writing, saving and sending one message.

## The draft lives on the server from the first moment

`POST /api/drafts` fires when the composer **opens**, not when the user first
types.

That is what makes an interrupted compose recoverable. A draft that exists only
in a ViewModel is lost when the process is killed — which on Android is a
routine event, not a crash. Paying one request on open buys the guarantee that
anything typed can be recovered from the Drafts mailbox on any client.

## Autosave

Debounced at 900ms. §15 is explicit that autosave must not create a request per
keystroke, so the pending save is cancelled on each edit and a burst of typing
produces exactly one `PUT` once it settles.

### The indicator can only say what the server confirmed

`SaveState` has no path to `Saved` except a successful response. The states are
deliberately distinct because each needs a different next action:

| State | Means | User's move |
|---|---|---|
| `Saving` | In flight | wait |
| `Saved` | Server confirmed | nothing |
| `Offline` | Never reached the server | wait for signal |
| `Failed` | Server said no | Retry |
| `Conflict` | Someone else saved first | choose |

Collapsing these into one "not saved" would merge three different situations
into a single unhelpful sentence.

### Conflicts are a real choice, not a merge

Every save carries the `version` last read. The server answers **409 with its
own copy attached** when that no longer matches — which is exactly what happens
when the same draft is open in a browser tab.

The app stops autosaving and asks: **Keep mine** (force-save, omitting the
version) or **Use theirs** (reload and discard local edits).

Neither is the default. Picking one automatically discards somebody's typing
without asking which, and continuing to autosave over a conflict would resolve
it by attrition, in favour of whoever typed last.

## Sending

The draft is **saved first, and the save must succeed.** Sending a draft whose
last edit never reached the server would send a different message from the one
on screen — the worst possible failure for a mail client, and completely
invisible to the sender.

### Idempotency

One `Idempotency-Key` per send *attempt*, **kept across retries of that
attempt**. A request that timed out but actually succeeded returns the original
result instead of sending twice. The key is held in the ViewModel and cleared
only on success; minting a fresh one at the call site would defeat the whole
mechanism.

### What "sent" is allowed to mean

A server with no SMTP transport still accepts the send and queues it. Reporting
that as "Sent" is a lie the sender only uncovers when nothing arrives.

| Server said | App says |
|---|---|
| `transportConfigured: false` | "Queued. This server has no mail transport configured, so it has not been delivered." |
| `delivery.status: sent` | "Message sent" |
| anything else | "Queued", with the server's own detail |

## Replies and forwards

`POST /api/drafts` with `{ mode, sourceId }` and **nothing else**. Recipients,
subject, quoted body, `In-Reply-To` and `References` are all derived by the
server from the stored message.

Not a convenience: a client-supplied `In-Reply-To` is a client-supplied claim
about what a message is answering, and building the quote locally would mean two
clients producing different quotes of the same message.

## Attachments

The system document picker, not a custom browser — the platform's picker already
reaches Drive, Photos, Downloads and every other provider on the device, none of
which an app-private browser can see.

Uploads **stream** from the content resolver straight to the socket. The server
accepts 100MB; buffering that into a `ByteArray` on a phone is an
`OutOfMemoryError`, not a slow upload. Progress is shown as indeterminate,
honestly — the body has no known content length, so a percentage would be
invented.

A failed upload **keeps its row**, carrying the error, until dismissed. A file
that silently fails to attach is one the sender discovers is missing after the
message has gone.

## Plain text, and why that is stated rather than hidden

The composer edits plain text. `textToHtml` wraps paragraphs and escapes `&`,
`<` and `>`; `htmlToText` reverses it for reopening.

**This is lossy for anything richer.** A draft written in the web client's
editor and reopened on Android keeps its words and loses its formatting.

A rich-text editor is real work, and faking one by round-tripping tags through a
plain field would silently destroy formatting a web user had applied — which is
worse than the honest limitation. Recorded here rather than discovered.

## Not implemented

| Feature | Status |
|---|---|
| Voice dictation (§13) | Not built. The toolbar has no microphone, rather than one that does nothing. |
| Rich text | Not built — see above |
| Scheduled send, signatures | Not on the web client either |
| Share-sheet into compose (§44) | Not built |
