# Composer final audit

**Date:** 2026-08-20
**Supersedes:** `COMPOSER-GAP-AUDIT.md` (same day, earlier). That document
listed the gaps; this one records which were closed and how each claim was
checked.

## How things were verified

Three kinds of evidence appear in the table. Nothing is marked `IMPLEMENTED`
because a component exists.

| Evidence | Meaning |
|---|---|
| **Test** | A `vitest` assertion. 300 pass across the workspace |
| **CDP** | Driven in real Chrome over the DevTools Protocol against the running app |
| **Wire** | A real message captured by an SMTP server and read back |

Verification runs this session:

- `verify-reopen.mjs` — **12/12**. Draft written, composer closed, draft
  reopened from the Drafts list, content compared.
- `verify-send.mjs` — **5/5**. Typed body, real send, message read off the wire.
- `npx turbo typecheck` — clean. `npx turbo test` — 300 passed.
  `npx next build` — compiled successfully.

---

## Feature status

| Feature | Status | Evidence |
|---|---|---|
| **Recipients (To/Cc/Bcc)** | `IMPLEMENTED` | Chips, paste, comma/semicolon/Enter/Tab/blur commit, case-insensitive de-dup. CDP |
| **Recipient autocomplete** | `IMPLEMENTED` | `GET /api/recipients`, drawn from the caller's own sent mail. Re-verified this session: after one real send, `?q=wire` returned that address with `count: 1` |
| **Address validation** | `IMPLEMENTED` | One `isValidAddress` shared by client and server, so the composer cannot accept what send rejects |
| **Invalid-address handling** | `IMPLEMENTED` | Marked chip rather than silent discard; Send disabled while any is invalid |
| **From / sender identity** | `PARTIAL` | Server computes authorised senders and validates the choice. The picker renders only when more than one exists, and no alias exists in practice, so it is usually invisible |
| **Subject** | `IMPLEMENTED` | Bound, autosaved, length-capped, CRLF-refused. **Empty subject now prompts** before sending — CDP |
| **Rich text** | `PARTIAL` | Bold, italic, underline, strike, lists, quote, code, link, clear formatting, **undo/redo**; toolbar reflects caret state. Still no font family/size, colour, alignment, indent |
| **Undo / redo** | `IMPLEMENTED` | Toolbar buttons present and wired to `document.execCommand`. CDP found both by label |
| **Link insertion** | `IMPLEMENTED` | Ctrl+K, scheme-validated at entry, selection restored across the dialog. CDP confirms `javascript:` is refused |
| **Link edit/remove** | `PARTIAL` | Clear-formatting unlinks. No dedicated edit-link affordance |
| **Attachments** | `IMPLEMENTED` | Upload, real progress, retry, cancel, remove, drag-drop, magic-byte type. CDP through to the wire |
| **Attachment limits** | `IMPLEMENTED` | From `GET /api/config`, re-enforced server-side |
| **Outbound size limit** | `IMPLEMENTED` | Body + attachments, measured before encoding. Fixed this session — see below |
| **Inline images** | `BACKEND ONLY` | MIME emits `cid:` parts and the sanitiser permits them; no editor insertion path |
| **Drive picker** | `NOT IMPLEMENTED` | No Drive backend. No button offers one |
| **Resumable upload** | `NOT IMPLEMENTED` | One streamed request; a failure at 90% restarts |
| **Malware scanning** | `NOT IMPLEMENTED` | No scanner, and no state claims "Safe" |
| **Draft autosave** | `IMPLEMENTED` | 800ms debounce; the status shown is the server's response. CDP |
| **Draft versioning** | `IMPLEMENTED` | `messages.version`; 409 carries the server's copy. Test: a save from a stale version loses, and the winning subject is the one that survives |
| **Draft reopen** | `IMPLEMENTED` | Clicking a draft row opens it in the composer. CDP: subject, body and recipients all restored, and **no extra draft is created** (6 before, 6 after) |
| **Discard draft** | `PARTIAL` | An untouched draft the composer itself created is deleted on close. A *reopened* draft is never auto-deleted. No explicit Discard action |
| **Unsaved-changes prompt** | `NOT IMPLEMENTED` | Close is silent. Acceptable while autosave holds; misleading if a save failed |
| **Send** | `IMPLEMENTED` | Real states; `sent` only after SMTP acceptance. Wire-verified this session |
| **Send failure** | `IMPLEMENTED` | Composer stays open, draft kept, reason shown, and a **Try again** button re-sends under the same idempotency key |
| **Idempotency** | `IMPLEMENTED` | `Idempotency-Key` against a `UNIQUE` column; the key is generated once per composer |
| **Schedule send** | `NOT IMPLEMENTED` | No scheduler. `messages.scheduled_at` exists and is unused |
| **Undo send** | `NOT IMPLEMENTED` | No delay window |
| **Read/delivery receipts** | `NOT IMPLEMENTED` | No UI, no headers |
| **Signature** | `NOT IMPLEMENTED` | `signatures` table exists; nothing reads it |
| **Reply / forward** | `BACKEND ONLY` | Send carries `inReplyTo` and `references`; no UI enters that mode |
| **Quoted-content sanitisation** | `IMPLEMENTED` | Applies to any HTML entering a draft |
| **AI writing** | `NOT IMPLEMENTED` | No AI backend. No panel is shown |
| **Header injection defence** | `IMPLEMENTED` | CR/LF/U+2028/U+2029/NUL refused in every header. Tested |
| **HTML sanitisation** | `IMPLEMENTED` | Allow-list, no styles, no svg/math, idempotent. 22 tests |
| **Bcc privacy** | `IMPLEMENTED` | Envelope only, never a header. Tested. A reopened draft still shows its own Bcc to its author — tested explicitly |
| **Sender authorisation** | `IMPLEMENTED` | 403 for an address the account does not own |
| **Cross-user draft access** | `IMPLEMENTED` | `user_id` in every WHERE. Test: `loadDraft` returns null for another account's draft |
| **Realtime** | `NOT IMPLEMENTED` | No WebSocket or SSE in the repo. Conflicts are caught on save |
| **Multi-device sync** | `PARTIAL` | Conflict detection only. No presence, no live merge |
| **Keyboard shortcuts** | `IMPLEMENTED` | Ctrl+Enter send, Esc close, Ctrl+K link, Ctrl+Shift+7/8 lists, Ctrl+Z / Ctrl+Shift+Z |
| **Mobile layout** | `PARTIAL` | Full-screen below `sm`, coarse-pointer targets. Not CDP-verified at mobile width for the composer specifically |
| **Dark mode** | `PARTIAL` | Tokens throughout, and the new banners use `warning-muted`/`warning-ink`, which are defined in both themes. Not visually verified for the composer |
| **Reduced motion** | `IMPLEMENTED` | Entry animation skipped through `useMotion` |
| **Haptics** | `IMPLEMENTED` | Selection on chip add, impact on remove, success/error on send |
| **Accessibility** | `PARTIAL` | Roles, labels, ARIA combobox, live regions, focus management. No screen-reader pass |

---

## Fixed this session

**A reopened draft rendered with an empty body.** Found by CDP, not by reading
code: the server held `<p>This sentence was left unfinished</p>` while the
editor showed nothing. The contentEditable wrote `value` into the DOM on mount
only — deliberately, because writing back what the user just typed moves the
caret to the start on every keystroke. But a reopened draft arrives *after* the
fetch resolves, so it never reached the DOM. The editor now remembers the HTML
it last emitted and writes only values that did not come from itself. Both
behaviours are verified: the body restores, and typed characters still land in
order.

**Reopening created a throwaway draft.** The first version created a blank
draft for its sender list and deleted it immediately. `GET /api/drafts/:id` now
returns `senders` alongside the draft, so either path is a single request and
nothing transient appears in Drafts. Confirmed: the draft count is unchanged
across a reopen.

**Closing could have deleted a draft the user meant to keep.** The composer
deletes an untouched draft on close, to avoid one empty shell per accidental
Compose click. That rule must not apply to a draft the user deliberately
reopened, so it is now scoped to drafts the composer itself created.

**`loadDraft` returned attachment ids without metadata.** A reopened draft
would have shown attachment rows it could not name or size. It now returns
filename, size and content type.

**Outbound size was measured wrongly** (carried over from the earlier audit).
The check summed attachments alone against an 18MB default chosen to leave room
for base64 inflation. Google's published limits state the cap applies to *"the
total size of the message content and attachments before encoding"* — so the
body counts and the encoded size does not. It now sums body + attachments
against a 25MB default, before encoding.

---

## Not fixed, and why

- **Signature, reply/forward, schedule send, undo send, receipts, Drive,
  AI writing.** Absent from the backend as well as the UI. Each would be a
  feature, not a gap-closure, and none is faked in the interface.
- **Resumable upload** and **malware scanning** need infrastructure that does
  not exist here. The UI makes no safety claim in the meantime.
- **Unsaved-changes prompt.** Autosave covers the ordinary case; the honest
  version of this prompt should fire only when a save has actually failed,
  which is worth doing properly rather than as a blanket confirm.

---

## Mock-data sweep

Production code (excluding `*.spec.ts`) searched for `mock`, `fake`, `dummy`,
`stub`, `lorem`, `sample data`, `hardcoded`, `TODO`, `FIXME`, `XXX`, `HACK`.

**Zero hits in production behaviour.** Every match is prose *about* not faking
things, or the lucide icon named `ListTodo`. Every `setTimeout` in the composer
is a debounce or a dismissal timer; none simulates progress.

---

## One thing the audit could not check

The request referred to attached screenshots as the visual reference. No images
came through, so the visual-parity comparison was not performed and nothing in
this document claims visual parity with a reference design. The layout rows
above describe structure and tokens only.
