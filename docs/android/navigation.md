# Navigation

What the Android app's navigation is, what it deliberately is not, and which of
the brief's destinations exist today.

## The honest status first

The target model is a hamburger drawer for mailboxes and settings, plus bottom
navigation for Inbox / Search / Storage / Account, plus a Compose FAB.

**What exists today is the drawer, the mailbox list and the Compose FAB.** There
is no bottom navigation yet, because three of its four destinations — Search,
Storage, Account — have no screen. A bottom bar with three tabs that open
nothing is not a partial implementation of navigation; it is a claim the app
then disproves four times a session.

The same rule governs the drawer. The brief describes sections for Storage,
Appearance, Security, Devices & sessions, Privacy, Notifications, About and
Help. Those are the right destinations for the finished product, and every one
of them is **absent** rather than present-and-inert. Each arrives with its
screen.

## What is in the drawer now

```
┌─────────────────────────────┐
│  (A)  Ada Lovelace          │   ← real display name and address from
│       ada@example.org       │     GET /api/auth/session
├─────────────────────────────┤
│  MAIL                       │
│   Inbox                4    │   ← unreadThreads, from GET /api/mailboxes
│   Drafts               2    │   ← totalThreads (see below)
│   Sent                      │   ← no count (see below)
│   Archive              0    │
│   Spam                 0    │
│   Trash                0    │
├─────────────────────────────┤
│   Sign out                  │
└─────────────────────────────┘
```

`LABELS` appears only when the account has labels. An empty section heading
suggests something is missing.

### Where the counts come from

Every number is a field on the server's mailbox record. None is derived from the
loaded page, which would report "3" for a mailbox holding three thousand.

| Mailbox | Shows | Why |
|---|---|---|
| Inbox, Archive, Spam, Trash, custom | `unreadThreads` | Unread is the meaningful number for a mailbox you receive into |
| Drafts | `totalThreads` | Nothing was ever received, so "unread" is not a fact about a draft; how many drafts exist is |
| Sent | *nothing* | Same reason, and a permanent `0` reads as a bug rather than as a fact |

**Zero is shown when the server says zero.** `null` means the server has no count
to give for that row, and nothing is drawn. Collapsing those two into one
representation is how a UI ends up inventing a number.

### Ordering

System mailboxes appear in the web sidebar's order — Inbox, Drafts, Sent,
Archive, Spam, Trash — and user-created folders follow, keeping the server's
`sortOrder`. A mailbox the server did not send is simply absent: the drawer
lists this account's real mailboxes, never a fixed menu with dead entries.

### Icons key off role, never name

A server may present the inbox as "Posteingang". Matching a display name would
silently fail on every non-English deployment — and the same rule protects the
delete policy, where the failure would not be a wrong icon but the wrong kind of
deletion. See `docs/mail-actions.md`.

## Drawer interactions

| Input | Result |
|---|---|
| Tap a mailbox | Close drawer, switch mailbox, clear selection |
| Swipe from left edge | Open drawer |
| Swipe drawer left | Close drawer |
| Back while open | Close drawer |
| Tap outside | Close drawer |

Edge-swipe is **disabled during a selection**: a horizontal drag then belongs to
the rows, and having it pull the drawer open instead makes the selection feel
broken.

Switching mailbox clears the selection. A selection is a set of ids in the
mailbox being left, and carrying it across would point the next action at
messages the user can no longer see.

## Back hierarchy

1. Drawer open → close drawer
2. Selection active → exit selection
3. Otherwise → system default

Implemented as two `BackHandler`s whose `enabled` guards encode that priority.
Order matters: handling selection first would exit a selection while the drawer
still covers the screen.

Conversation, compose, search and bottom sheets join this list as they land.

## Signed-out and signed-in are different trees

Not different routes in one graph. A signed-out user must not be able to reach a
mail screen by any navigation action, and the surest way to guarantee that is
for those screens not to be in the graph at all.

`AuthState.Resolving` is a real third state with its own UI. Rendering the
sign-in screen while the stored session is still being checked would flash a
login form at an already-signed-in user on every cold start.

## Roadmap

| Destination | State |
|---|---|
| Drawer, mailboxes, real counts | Implemented |
| Thread list, selection, swipe, pull-to-refresh | Implemented |
| Conversation | Not yet — `onOpenThread` is deliberately inert |
| Compose | Not yet — the FAB is deliberately inert |
| Search | Not yet |
| Storage | Not yet |
| Account / Security / Devices / Appearance / Notifications | Not yet |
| Bottom navigation | Blocked on the three destinations above |
| Adaptive layout for tablets and foldables | Blocked on the conversation screen |
| Deep links, share sheet, launcher shortcuts | Not yet |

The two inert callbacks (`onOpenThread`, `onCompose`) are the one compromise
here: the row and the FAB are visible and do nothing. They stay visible because
they are structural to the list's layout, and a list with no rows to tap is not
a testable inbox — but neither navigates to a placeholder screen, because a stub
that looks like a feature is how a parity matrix starts lying.
