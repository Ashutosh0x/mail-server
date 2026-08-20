# Mail actions and deletion

What each action does, and what "Delete" means in each mailbox. The second
question matters more than it looks: delete is not one operation, and shipping
two behaviours behind one unlabelled button is how people lose mail.

## Operations

All of them go through `POST /api/mail/actions`, which is bulk by design —
archiving fifty messages is one transaction and one round trip.

| Operation | Effect | Reversible |
|---|---|---|
| `read` / `unread` | Sets the read flag | Yes |
| `star` / `unstar` | Sets the flagged keyword | Yes |
| `archive` | Moves to Archive | Yes, via `restore` |
| `spam` | Moves to Spam | Yes, via `restore` |
| `trash` | Moves to Trash | Yes, via `restore` |
| `restore` | Moves back to Inbox | Yes |
| `delete` | Soft delete: sets `deleted_at` | Not through the UI |
| `purge` | **Destroys the row and its attachment bytes** | **No** |

`purge` is deliberately not a `MessageAction`. Everything else moves a row or
flips a flag; purge destroys both the record and the file, so it takes the
storage-cleanup path — blobs before rows, partial failure reported honestly —
rather than becoming a tenth case in a switch where it would read as a sibling
of "archive".

## What Delete means, per mailbox

| Mailbox | Operation | Button | Confirms first |
|---|---|---|---|
| Inbox, Sent, Archive | `trash` | "Delete" | No — Undo is offered instead |
| Trash | `purge` | "Delete permanently" | **Yes** |
| Spam | `purge` | "Delete permanently" | **Yes** |
| Drafts | `purge` | "Delete draft" | **Yes** |

Reversible deletions are not confirmed. A dialog people meet constantly is one
they learn to dismiss without reading, which makes the ones that matter less
effective — so the confirmation is spent only where it cannot be undone.

Drafts skip Trash entirely: a draft was never sent, so Trash would only be a
second place for it to sit unfinished.

The policy lives in `components/mail-selection.ts` and is covered by tests,
because a regression there does not throw or render wrong — it quietly deletes
mail someone expected to find in Trash.

## Actions offered, per mailbox

Only actions that can do something in the current mailbox appear. "Restore"
belongs in Trash, Spam and Archive; "Not spam" only in Spam; neither belongs in
the Inbox. An action offered where it is meaningless is a button that appears
to fail.

Drafts offer no state actions at all — a draft cannot be archived, starred or
marked read, because it was never received.

## Authorization

The client's list of ids is never trusted. Both `applyAction` and
`deleteMessages` carry `user_id` in their WHERE clauses, so an id belonging to
another account matches nothing. The response reports `changed` alongside
`requested`, and a lower number is the signal the UI reconciles against —
verified: an unknown id returns `changed: 0` with the failure listed, never a
reported success.

## Attachments

`trash` does not touch attachment bytes: the message may come back.

`purge` deletes blobs before rows, so a storage failure leaves a still-listed
attachment rather than an invisible orphan consuming quota. Before deleting the
bytes it checks whether another attachment row references the same
`storage_key`; if one does, the record is removed and the file is kept. No
dedup exists today so this cannot trigger, but it is what keeps the invariant
true if content-addressed storage is ever added.

## The selection toolbar

A selection **replaces** the status bar rather than adding items to it.

That distinction was a real defect, not a style preference. The Delete button
originally sat in the 12px status bar beside the conversation count and the
keyboard hints. It rendered, it was clickable, and a hit test at its centre
passed — but at 73x20px among captions it *read* as status rather than as an
action, and the reasonable conclusion was that the feature was missing. A
control that is technically present and perceptually absent is not implemented.

With a selection, the bar becomes `role="toolbar"`: normal-sized text, buttons
that look like buttons, and Delete styled as destructive at 94x32. Delete is
never behind More — it is the action people opened the toolbar for.

The row's select control carries `role="checkbox"` and `aria-checked`, not a
bare button. A button announces only its label, so a screen-reader user heard
"Select subject, button" with no way to know whether it was already selected.

## Selection

Select-all covers **the current page only**, and says so. "Select all in Inbox"
is a different promise — one that reaches rows the user has never seen — and
conflating the two is how a bulk delete takes more than was intended. When more
conversations exist beyond the page, the header states that they are not
selected.

The selection is cleared after every action. Leaving it in place means the next
action silently targets messages that have moved or gone.

## Keyboard

`Delete` and `Backspace` follow the same policy as the button: reversible where
a Trash can receive it, confirmed where it cannot. A shortcut must not be the
one path that destroys mail without asking.

Shortcuts are ignored while typing in an input, a textarea or a contenteditable.
