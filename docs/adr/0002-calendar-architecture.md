# ADR-0002 — Calendar as a CalDAV client, not a datastore

**Status:** Accepted, 2026-08-20. Supersedes the Calendar section of the
original Master Blueprint v2.0/v2.1.

## Context

The blueprints specify Calendar as an independent subsystem with its own
datastore, its own event model, and its own implementations of recurrence,
invitations and free/busy. That plan was written against an understanding of
Stalwart as a mail-only engine.

Verification on 2026-08-19/20 found that Stalwart v0.16.14 provides, natively:

| Capability | Standard | Source |
|---|---|---|
| Calendar access | CalDAV, RFC 4791 | Stalwart docs |
| Scheduling / invitations | CalDAV Scheduling Extensions, RFC 6638 | Stalwart docs |
| Scheduling message semantics | iTIP, RFC 5546 | Stalwart docs |
| Email-transported scheduling | iMIP, RFC 6047 | Stalwart docs |
| Collection sync | RFC 6578 sync-tokens | Stalwart docs |
| Free/busy lookups | CalDAV | Stalwart docs |
| Server-side alarms | `alarms_minimum_interval`, `alarms_template` | Stalwart docs |
| RSVP over HTTP | Stalwart extension | Stalwart docs |
| Calendar CRUD, attendees, sharing | CalDAV | Stalwart docs |
| JMAP for Calendars | JMAP Calendars | Stalwart docs |

Scheduling is enabled by default upstream.

Recurrence, timezone handling and invitation state machines are the three parts
of calendaring that are genuinely hard and genuinely standardised. RFC 5545
recurrence alone — `RRULE`, `EXDATE`, `RDATE`, `RECURRENCE-ID` overrides,
`UNTIL` versus `COUNT`, DST transitions across a recurring series — is a
multi-year correctness problem that interoperability testing has already solved
in the CalDAV ecosystem. Reimplementing it produces a system that disagrees with
every existing client about what time a meeting is.

## Decision

**Calendar is a client and product layer over CalDAV. There is no second
calendar datastore.**

```
                    Mail Server UI
                          │
                 Calendar product layer
                  (views, UX, batching)
                          │
                    CalDAV client
                          │
                 Stalwart  ── CalDAV / iTIP / iMIP ── external organisers
```

Capability ownership:

| Capability | Owner |
|---|---|
| Event storage, iCalendar parsing, recurrence expansion | **Stalwart** |
| Invitations, RSVP, free/busy, alarms, ACLs, sync-tokens | **Stalwart** |
| Calendar collections and sharing primitives | **Stalwart** |
| Multi-calendar overlay, working hours, timezone display | **Mail Server** |
| Scheduling assistant UI over free/busy responses | **Mail Server** |
| Cross-surface links (event ↔ thread ↔ file) | **Mail Server** |
| Keyboard model, density, offline cache | **Mail Server** (client-only UX) |
| Room and resource booking policy | **Not currently supported** — needs design |

The one legitimate reason to add local storage is a **cache**, keyed by
sync-token, that can be discarded and rebuilt from the server at any time. A
cache is not a source of truth: if it disagrees with Stalwart, the cache is
wrong. Any write goes to CalDAV first.

## Alternatives considered

**Ground-up datastore (the blueprint's plan).** Rejected. It means owning
recurrence and scheduling correctness forever, and it produces a calendar that
external organisers cannot invite people into without a bridge we would also own.

**JMAP for Calendars instead of CalDAV.** Deferred, not rejected. JMAP is the
better protocol — batched, no XML, one auth model with mail. But CalDAV is what
every existing client speaks, and Stalwart supports both. Build the client
against CalDAV for interoperability; revisit JMAP for our own first-party
clients once the product layer is stable.

**Local storage with periodic push to CalDAV.** Rejected. Two writers to one
calendar produces conflicts that neither side can resolve correctly, and the
failure mode is a meeting that exists for one attendee and not another.

## Security implications

Delegation and ACLs are enforced by Stalwart at the protocol layer, which means
our client must not implement its own idea of who may see a calendar. It asks
and honours the answer. This mirrors the storage federation rule: the layer
closest to the data is final in the restrictive direction.

Free/busy is an information-disclosure surface — it reveals when someone is
occupied even to a caller who cannot read event details. That distinction is
Stalwart's to enforce, and our UI must not infer details from busy blocks.

## Performance implications

`NOT MEASURED`. No calendar code exists. When it does, the figure that matters
is recurrence expansion latency for a dense year view, and it will be measured
under the methodology in ADR-0006 before any number is stated.

## Migration implications

None yet — no calendar data exists in this system. Importing existing calendars
is Vandelay's job (ADR-0007), not ours.

## Consequences

Scope removed from the roadmap: event storage schema, recurrence engine,
iTIP/iMIP state machine, free/busy computation, alarm scheduler. Scope
retained: everything a user actually sees.
