# Audit verification

**Date:** 2026-08-20
**Subject:** two pasted audit reports — a codebase audit and a competitive gap
analysis — checked claim by claim against the repository.

Reports like these are useful for direction and unreliable on detail. This
document records which claims held up. Where a claim was wrong, the evidence is
named so the correction can itself be checked.

---

## Summary

| | Count |
|---|---|
| Claims verified as **TRUE** | 21 |
| Claims **FALSE** or already fixed | 6 |
| Claims **TRUE but by design** (not defects) | 3 |
| Fixed in response to this audit | 9 |

The reports were generated against a snapshot roughly one commit old — they
report 296 tests where there were 300 at the time of reading, and list draft
reopening as unbuilt after it had shipped. That timing explains most of the
false claims, including both "critical bugs".

---

## The two "critical bugs"

### BUG-001 — `openDraftId` and `dirty` undeclared in `composer.tsx`

**FALSE.** Both are declared:

- `openDraftId` is a declared prop — `composer.tsx:42`
- `dirty` is `useRef(false)` — `composer.tsx:85`

`npx turbo typecheck` passes across all three packages. The claim describes a
state that existed only inside an editing window, when the reopen body had been
written but the prop declaration had not yet landed. It was never committed.

### BUG-002 — reading pane action buttons have no handlers

**TRUE, and now fixed.** Six buttons rendered with `title` and shortcut labels
and no `onClick`. They were hoverable and did nothing — a direct violation of
the project's own "no dead buttons" rule.

What was done, per button:

| Button | Resolution |
|---|---|
| Reply | Built. Server-side reply draft, opened in the composer |
| Reply all | Built. Adds the other recipients, never this account |
| Forward | Built. `Fwd:`, quoted, and deliberately **no** recipients |
| Archive | Wired to the existing action pipeline |
| Delete | Wired to `trash` (not permanent delete) |
| Snooze | **Removed.** There is no scheduler behind it. An absent button is honest; a dead one is not |

---

## Claims that held up

| Claim | Verdict | Evidence |
|---|---|---|
| No CI/CD pipeline | TRUE | No `.github/workflows`, no CI config anywhere |
| `SECRETS_KEY` missing from `.env.example` | TRUE | Required at `secrets.ts:35`, absent from the template. **Fixed** |
| `docker-compose.yml` uses obsolete `version: '3.8'` | TRUE | Line 1. **Fixed** |
| Rspamd and ClamAV have no healthchecks | TRUE | Other four services had them. **Fixed** |
| Hardcoded credentials in compose | TRUE | **Fixed** — now `${VAR:-dev-default}` |
| `.gitignore` misses `*.key`, `*.crt`, IDE dirs | TRUE | Only `*.pem` was listed. **Fixed** |
| No turbo `globalEnv` | TRUE | Env changes left stale cached builds. **Fixed** |
| No `clean` script | TRUE | **Fixed** |
| Rate limiting only on login | TRUE | `login/route.ts:47`, address-based. No other endpoint is throttled |
| No CSRF protection | TRUE | Zero matches in source; cookie is `sameSite: "lax"`, not `strict` |
| 14 directories are empty placeholders | TRUE | Verified individually: all 14 contain only `.gitkeep` |
| No API routes for signatures, rules, vacation, aliases, domains, distribution lists | TRUE | 33 routes enumerated; none of those exist |
| No folder create/rename/delete | TRUE | No such route |
| Reading pane shows plain text, not HTML | TRUE | By design and disclosed in the UI |
| Inbound mail (IMAP/JMAP) not built | TRUE | Confirmed live: the Inbox has zero rows because nothing can arrive |
| Stalwart never executed | TRUE | Docker is not even installed on this machine |
| Storage benchmarks unmeasured | TRUE | All scenarios still `NOT_MEASURED` |
| SMTP delivery is inline, no queue worker | TRUE | `transport.ts` runs in the request |
| No OpenAPI spec, no API versioning | TRUE | — |
| S3 driver not implemented | TRUE | Filesystem and NFS only |
| Server logic lives inside `apps/web` | TRUE | A real portability constraint |

---

## Claims that were wrong

| Claim | Verdict | What is actually true |
|---|---|---|
| BUG-001 (undeclared variables) | **FALSE** | Both declared; typecheck clean |
| "Reopen drafts — not built" (P0 #3, competitive #6) | **FALSE** | Shipped and CDP-verified 12/12 before the audit was written |
| "Virtualized list ✅ (TanStack)" | **FALSE** | `@tanstack/react-virtual` is declared in `package.json` and **imported nowhere**. `useVirtualizer` appears in zero files. The list is not virtualized |
| "Search chips ✅ (types)" | **MISLEADING** | The grammar is not types-only — `parseQuery` is wired into `mail.ts:124` and FTS5 `MATCH` runs at `mail.ts:243` |
| "296 tests" | **STALE** | 300 at the time of the audit; 308 now |
| "HTML sanitisation pipeline is not built" (implied by the reading-pane comment the audit quotes) | **FALSE** | `sanitize.ts` exists with 22 tests and every outbound body passes through it. What is missing is remote-image blocking, tracker stripping and a sandboxed frame. The stale comment has been corrected |

---

## Claims that are true but not defects

| Claim | Why it stands as it is |
|---|---|
| `pg` not declared in `packages/database` | Deliberate. It is imported lazily so `migrate --dry-run` works without it, and the error message says exactly what to install. `migrate.mjs:82` documents this |
| CSP uses `unsafe-inline` | Next.js requires it for bootstrap unless nonce-based CSP is configured. Real, but a framework constraint, not an oversight |
| Top-level `tests/` is empty | Tests live beside the code they cover. The directory could go, but its emptiness is not a gap in coverage |

---

## Fixed in this pass

1. **Reply, reply-all and forward** — built server-side (`createReplyDraft`).
2. **Archive and Delete** in the reading pane — wired to the existing pipeline.
3. **Snooze** — removed rather than left dead.
4. **`SECRETS_KEY`** — added to `.env.example` with generation instructions and
   a warning that no rotation mechanism exists yet.
5. **`docker-compose.yml`** — obsolete `version` key removed, healthchecks added
   for Rspamd and ClamAV, credentials moved to environment variables with dev
   defaults.
6. **`.gitignore`** — `*.key`, `*.crt`, `*.cer`, `*.pfx`, `*.p12`, `.vscode/`,
   `.idea/`.
7. **`turbo.json`** — `globalEnv` listing all 25 server-read variables.
8. **`clean` script.**
9. **Stale comment** in the reading pane that denied the existence of the
   sanitiser.

### Why reply/forward is built on the server

The reading pane deliberately shows a plain-text preview because the HTML read
path is not safe yet. A reply implemented in the composer would have needed the
original body in the browser to quote it — quietly undoing that decision.

So `POST /api/drafts` accepts `{ mode, sourceId }` and returns a draft that is
already populated. The client never sees the source body; it just opens the
draft using the same reopen path built the day before. Threading headers are
read from the row rather than accepted from the request, so naming another
message id cannot forge a `References` chain.

Forward deliberately starts with **no recipients**. Pre-filling them is how a
private thread gets leaked to the wrong person.

---

## Verification

- `npx turbo typecheck` — clean
- `npx turbo test` — **308 passing** (types 57, ui 33, database 10, web 208)
- `verify-reply.mjs` — **17/17** in real Chrome: reply/forward drafts created,
  subjects prefixed without stacking, forward has no recipients, unknown id
  returns 404 rather than 403, invalid mode returns 400, plain Compose still
  returns 201, the action row renders without Snooze, and clicking Reply opens
  the composer prefilled with the recipient and the quoted body
- A hard reload with cache disabled produced **zero console errors**

### Not verified

The `docker-compose.yml` changes are **unverified**. Docker is not installed on
this machine, so the healthcheck commands (`rspamc stat`, `clamdcheck.sh`) have
not been executed against a running container. They follow each image's
documented convention, and the file now says so in a header comment.

---

## On the roadmap in the second report

The sequencing is sound and matches `docs/roadmap.md`: inbound mail is the
blocker, and everything downstream of it — calendar, contacts, protocol
features — stays blocked until Stalwart actually runs.

Two things in that report are worth treating with care. The feature counts
("120+ missing", "~85 to match Gmail") are not derived from anything checkable
and should not be quoted as measurements. And several "🏆 differentiator" rows
describe work measured in months of research, listed beside items estimated at
one day, which flattens a very real difference in cost.
