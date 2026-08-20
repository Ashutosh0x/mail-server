# Gestures

Every gesture the Android app recognises, what it does, and — for each one — the
button that does the same thing.

## The rule that governs the rest

**Nothing is gesture-only.** Every action reachable by a swipe or a long press is
also reachable through a visible control. A gesture is a shortcut for people who
know it, never the only door.

This is not only an accessibility requirement, though it is that: a switch-access
or TalkBack user cannot perform a positional swipe at all. It is also how a
feature stays discoverable for everyone else.

| Gesture | Also available as |
|---|---|
| Swipe left to archive | Selection toolbar → Archive |
| Swipe right to mark read/unread | Selection toolbar → More → Mark read/unread |
| Long-press to select | Row tap while already in selection mode |
| Pull to refresh | Top bar → Refresh |
| Edge swipe to open drawer | Top bar → ☰ |

`MailPolicyTest` asserts the swipe/toolbar correspondence directly, so a future
swipe that has no button equivalent fails the build rather than shipping.

## Swipe on a conversation row

**Progress is continuous; activation is discrete.** As the finger moves, the
background action fades and scales in — the user can see what is about to
happen and how close they are to it. The action fires only when the row passes a
positional threshold *and is released*. A short swipe springs back having done
nothing, which is what makes the gesture safe to explore.

| Direction | Action | Threshold |
|---|---|---|
| Right (`StartToEnd`) | Mark read / mark unread, whichever the row is not | 35% |
| Left (`EndToStart`) | Archive, or Delete where there is nothing to archive out of | 35%, or **60%** when destructive |

Directions are named for the reading direction, not for left and right, so both
mirror correctly in a right-to-left locale.

### Why the threshold differs

A destructive action a thumb can reach in a short flick is one that gets
triggered in a pocket. Making it a committed gesture — most of the row's width —
is the cheapest safety there is.

The threshold is chosen **per direction**, not per row. A row that offers a
destructive action one way and a harmless one the other must not make the
read/unread toggle as hard to reach as a delete; punishing the safe gesture for
the dangerous one's sake is a real regression that an earlier draft of
`SwipeActions.kt` had.

### Where swipe-to-delete does not exist

In **Trash, Spam and Drafts** there is no left swipe at all.

Deletion in those mailboxes is `purge` — it destroys the record and the
attachment bytes, and nothing brings them back. An irreversible action must not
be reachable by a gesture that can be started by accident. Those mailboxes
delete through the toolbar, behind the confirmation dialog.

### The row is never dismissed by the gesture

`confirmValueChange` always returns `false`. The row springs back, the action
goes to the server, and the list re-reads from the response.

Letting the row animate away on release would be the client asserting a result
it has not been told. If the server refuses, an animated-away row leaves a hole
where a message still is.

## Long press

Enters selection mode, with a `SelectionStart` haptic — distinctly stronger than
a selection tap, because this is the gesture that *changes mode*, and the pulse
is what tells the user their press registered before the bar animates.

While a selection is active:

- **Row tap** toggles that row rather than opening it.
- **Swipe is disabled.** A horizontal drag then belongs to the selection, and
  acting on a single row mid-selection is almost never what was meant.
- **Drawer edge-swipe is disabled**, for the same reason — having the drawer
  pull open during a selection makes the selection feel broken.

## Pull to refresh

On the thread list. The haptic fires once when the pull crosses the point where
releasing would actually refresh, so the gesture has a felt boundary.

A refresh over existing content keeps the content visible and marks it
refreshing, rather than flashing a spinner over a list the user is reading.

## Back

The hierarchy, in priority order:

1. **Drawer open** → close the drawer.
2. **Selection active** → exit selection.
3. Otherwise → the system default (leave the app from the mailbox root).

Order matters. Handling selection before the drawer means Back exits a selection
while a drawer is still covering the screen.

Conversation and compose join this list as their screens land — see
`navigation.md` for what exists today.

## Star

A tap target of 48dp — the platform minimum — even though the glyph is 20dp,
because a star that needs aiming for is one people stop using.

**There is no optimistic flip.** The icon shows the server's `$flagged` keyword
and nothing else: the tap sends the action, the list re-reads, and the icon
follows what came back. A star that turns gold and stays gold after the server
refused it is the app lying about the account's state.

## Not implemented yet

| Gesture | Blocked on |
|---|---|
| Predictive back from a conversation | The conversation screen |
| Swipe between conversations | The conversation screen |
| Swipe-to-dismiss on compose | The composer |
| Drag-to-reorder, pinch density | Not planned; density is a setting on web too |
