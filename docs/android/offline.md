# Offline

## Status: not implemented

Stated plainly because the brief (§27, §28) describes it in detail, and it is
reasonable to assume from a docs directory that it exists.

**Today the app requires a reachable server.** There is no Room cache, no
operation queue and no background sync.

## What already holds

Two pieces of the offline contract are in place, because they are correctness
rules rather than features:

- **A network failure never signs the user out.** Only an explicit 401 does.
  Losing signal would otherwise destroy the session and any unsent work with it.
- **The composer distinguishes `Offline` from `Failed`.** "Not saved — you
  appear to be offline. It will be saved when the connection returns" is a
  different sentence from "the server rejected this", and they are different
  states in `SaveState`.

## The rule any implementation must obey

**Never claim a server operation succeeded while offline.**

```
Queued for sending        ✅
Sent                      ❌
```

Not a wording preference. A mail client that says "Sent" for a message sitting
in a local queue has told the user something they will act on — they close the
app, they assume it arrived, and they find out days later that it did not.

The same applies to every action. A queued archive is *queued*, not archived,
and the row does not move until the server says it moved.

## What building it involves

1. **Room as a cache, never as the truth.** The server owns mailbox state. Room
   holds what was last seen so the list renders instantly and survives a dead
   network. A stale local row must never silently overwrite newer server state —
   §49 — and conflicts are handled explicitly rather than by last-write-wins.

2. **An operation queue with real conflict handling.** Actions taken offline are
   recorded, shown as pending, and replayed on reconnect. Replay must cope with
   the message having moved or been deleted meanwhile — and the existing
   `changed` vs `requested` signal from `/api/mail/actions` is exactly the
   reconciliation mechanism for that. The app already reads it.

3. **`WorkManager` for sync**, so it survives process death and respects Doze.

4. **A subtle network indicator.** §28 asks for `Online / Offline / Reconnecting
   / Syncing` as a small status, not a banner. A banner that appears in every
   tunnel and lift is one people learn to ignore.

## Why the ordering matters

The current rule — *nothing is applied locally; the server is re-read after
every action* — is what guarantees the app can never show a state the server
rejected.

Offline support is the one place that rule has to bend, and it has to bend
**visibly**: a pending operation is rendered as pending, not as done. Adding a
cache without that distinction would quietly convert the app's strongest
correctness property into its most misleading one.
