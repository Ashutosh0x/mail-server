# ADR-0003 — Contacts as a CardDAV client, with one deliberate exception

**Status:** Accepted, 2026-08-20. Supersedes the Contacts section of the
original Master Blueprint v2.0/v2.1.

## Context

As with Calendar (ADR-0002), the blueprints specify Contacts as an independent
subsystem. Stalwart v0.16.14 provides CardDAV (RFC 6352) natively: vCard address
books, principal discovery, and incremental sync through RFC 6578 sync-tokens.

Contacts differs from Calendar in one way that matters. A workspace has **two**
kinds of contact data:

1. **Personal address books** — the user's own contacts. Mutable by them,
   private by default, and exactly what CardDAV is for.
2. **The organisation directory** — every member of the tenant. Derived from
   `users` and `tenants`, which already exist in migration `0001`. It is not
   user-editable, it is authoritative for internal identity, and it must reflect
   an account being deprovisioned immediately.

Treating the directory as an address book would mean syncing our own user table
into a vCard collection and then reading it back, which introduces a lag between
"account disabled" and "account still autocompletes in the composer."

## Decision

**Personal contacts live in CardDAV. The organisation directory is projected
from the existing platform tables. Neither is a copy of the other.**

```
   Personal address books ──► CardDAV ──► Stalwart      (source of truth)

   Organisation directory ──► users / tenants tables    (source of truth)

                         └──────┬──────┘
                    unified read model
                 (search, autocomplete, profile)
```

Capability ownership:

| Capability | Owner |
|---|---|
| vCard storage, parsing, address book collections | **Stalwart / CardDAV** |
| Contact CRUD, groups where the server supports them | **Stalwart / CardDAV** |
| Incremental sync (`sync-token`) | **Stalwart / CardDAV** |
| Organisation directory, deprovisioning | **Mail Server** platform tables |
| Unified search across both sources | **Mail Server** |
| Email autocomplete ranking | **Mail Server** (client-only UX) |
| User profile integration | **Mail Server** |
| Contact photos | **Deferred** — CardDAV supports inline `PHOTO`; size policy unresolved |

"Unified read model" means a query layer that reads both sources and merges
them for display. It stores nothing durable. When a directory entry and a
personal contact describe the same address, the directory entry wins for
identity fields (name, organisation, title) because it is authoritative, and the
personal contact wins for the user's own annotations.

## Alternatives considered

**Everything in CardDAV, including the directory.** Rejected: deprovisioning
becomes eventually-consistent, and the window where a disabled account still
autocompletes is a real access-control problem.

**Everything in our own tables, CardDAV as an export.** Rejected for the same
reason as ADR-0002 — it makes us the owner of a synchronisation problem that the
protocol already solves, and breaks every external CardDAV client.

**No personal address books at all; directory only.** Rejected. Users have
contacts outside the organisation; that is most of what a contact list is for.

## Security implications

The directory is tenant-scoped, and that scoping is not optional: a directory
query must filter on the caller's `tenant_id` the same way every mail query
filters on `user_id`. Cross-tenant directory disclosure would be the contacts
equivalent of the cross-tenant mount escalation that `effectiveAccess()` exists
to prevent.

Personal address books are private to their owner by CardDAV ACL. Our client
must not present a merged view that leaks one user's personal contacts into
another's autocomplete.

## Performance implications

`NOT MEASURED`. Autocomplete latency is the figure that will matter, since it
sits in the composer's keystroke path, and it will be measured before it is
claimed.

## Migration implications

Vandelay imports address books (ADR-0007). The directory needs no migration — it
is derived from accounts that already exist.

## Consequences

Scope removed: vCard parser, contact storage schema, address book sync engine.
Scope retained: the directory projection, the merge rules, and the search and
autocomplete experience.
