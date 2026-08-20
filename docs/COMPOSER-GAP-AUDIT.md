# Composer gap audit

**Date:** 2026-08-20
**Method:** repository inspection, plus CDP runs against a live SMTP server.
Nothing below is marked implemented on the strength of a component existing —
each row names the evidence.

## Status vocabulary

| Status | Meaning |
|---|---|
| `IMPLEMENTED` | Working end to end, with a test or a CDP run behind it |
| `PARTIAL` | Real but incomplete. The gap is stated |
| `BACKEND ONLY` | The server can do it; no UI reaches it |
| `NOT IMPLEMENTED` | Absent. No UI pretends otherwise |

---

## Feature status

| Feature | Status | Evidence |
|---|---|---|
| **Recipients (To/Cc/Bcc)** | `IMPLEMENTED` | Chips, paste, comma/semicolon/Enter/Tab/blur commit, backspace-to-edit, case-insensitive de-dup. CDP-verified |
| **Recipient autocomplete** | `IMPLEMENTED` | `GET /api/recipients`, from the caller's own sent mail. ARIA combobox, arrow keys. CDP-verified |
| **Address validation** | `IMPLEMENTED` | Shared `isValidAddress` between client and server — one definition, so the composer cannot accept what send rejects |
| **Invalid-address handling** | `IMPLEMENTED` | Shown as a marked chip rather than discarded; Send disabled while any is invalid |
| **From / sender identity** | `PARTIAL` | Server computes authorised senders from `users` + `aliases` and validates the selection. The picker only renders when more than one exists, and no alias exists in practice, so it is usually invisible |
| **Subject** | `PARTIAL` | Bound, autosaved, length-capped, CRLF-refused. **No empty-subject confirmation** |
| **Rich text** | `PARTIAL` | Bold, italic, underline, strike, lists, quote, code, link, clear formatting — all working, toolbar reflects caret state. **No undo/redo buttons, font family/size, colour, alignment, indent** |
| **Link insertion** | `IMPLEMENTED` | Ctrl+K, scheme-validated at entry, selection restored across the dialog. CDP-verified that `javascript:` is refused |
| **Link edit/remove** | `PARTIAL` | Clear-formatting unlinks. No dedicated edit-link affordance |
| **Attachments** | `IMPLEMENTED` | Upload, real progress, retry, cancel, remove, drag-drop, magic-byte type. CDP-verified through to the wire |
| **Attachment limits** | `IMPLEMENTED` | From `GET /api/config`, re-enforced server-side |
| **Inline images** | `BACKEND ONLY` | MIME emits `cid:` parts and the sanitiser permits them; no editor insertion path |
| **Drive picker** | `NOT IMPLEMENTED` | No Drive backend. No button offers one |
| **Resumable upload** | `NOT IMPLEMENTED` | One streamed request; a failure at 90% restarts |
| **Malware scanning** | `NOT IMPLEMENTED` | No scanner. No state claims "Safe" |
| **Draft autosave** | `IMPLEMENTED` | 800ms debounce, status from the server's response |
| **Draft versioning** | `IMPLEMENTED` | `messages.version`, 409 with the server's copy attached |
| **Draft recovery / reopen** | `NOT IMPLEMENTED` | Drafts persist and appear in the Drafts mailbox, but nothing reopens one in the composer |
| **Discard draft** | `PARTIAL` | An untouched draft is deleted on close. No explicit Discard action |
| **Unsaved-changes prompt** | `NOT IMPLEMENTED` | Close is silent. Acceptable while autosave holds, misleading if a save failed |
| **Send** | `IMPLEMENTED` | Real states; `sent` only after SMTP acceptance. CDP-verified |
| **Send failure** | `PARTIAL` | Composer stays open, draft is kept, reason is shown. **No Retry button** — the user presses Send again |
| **Idempotency** | `IMPLEMENTED` | `Idempotency-Key` against a `UNIQUE` column |
| **Schedule send** | `NOT IMPLEMENTED` | No scheduler. `messages.scheduled_at` exists and is unused |
| **Undo send** | `NOT IMPLEMENTED` | No delay window |
| **Read/delivery receipts** | `NOT IMPLEMENTED` | No UI, no headers |
| **Signature** | `NOT IMPLEMENTED` | `signatures` table exists; nothing reads it |
| **Reply / forward** | `BACKEND ONLY` | Send carries `inReplyTo` and `references`; no UI enters that mode |
| **Quoted-content sanitisation** | `IMPLEMENTED` | Applies to any HTML entering a draft, including future quoted content |
| **AI writing** | `NOT IMPLEMENTED` | No AI backend. No panel is shown |
| **Header injection defence** | `IMPLEMENTED` | CR/LF/U+2028/U+2029/NUL refused in every header. Tested |
| **HTML sanitisation** | `IMPLEMENTED` | Allow-list, no styles, no svg/math, idempotent. 22 tests |
| **Bcc privacy** | `IMPLEMENTED` | Envelope only, never a header. Tested |
| **Sender authorisation** | `IMPLEMENTED` | 403 for an address the account does not own |
| **Cross-user draft access** | `IMPLEMENTED` | `user_id` in every WHERE; 404 not 403 |
| **Realtime** | `NOT IMPLEMENTED` | No WebSocket or SSE anywhere in the repo. Conflicts are detected on save |
| **Multi-device sync** | `PARTIAL` | Conflict detection only. No presence, no live merge |
| **Keyboard shortcuts** | `PARTIAL` | Ctrl+Enter send, Esc close, Ctrl+K link, Ctrl+Shift+7/8 lists. **No Ctrl+Z/Y buttons; browser undo applies** |
| **Mobile layout** | `PARTIAL` | Full-screen below `sm`, coarse-pointer touch targets. **Not CDP-verified at mobile width for the composer specifically** |
| **Dark mode** | `PARTIAL` | Uses tokens throughout; verified for the account center, **not for the composer** |
| **Reduced motion** | `IMPLEMENTED` | Composer entry animation is skipped through `useMotion` |
| **Haptics** | `IMPLEMENTED` | Selection on chip add, impact on remove, success/error on send |
| **Accessibility** | `PARTIAL` | Roles, labels, ARIA combobox, live regions, focus management. **No screen-reader pass** |

---

## Fixed during this audit

**Outbound size was measured wrongly.** The check summed attachments alone and
compared them against an 18MB default chosen to leave room for base64
inflation. Google's published limits state the cap applies to *"the total size
of the message content and attachments before encoding"* — so the body counts,
and the encoded size does not. A message with a large quoted thread could
exceed a receiver's cap while passing our check, and the compensation refused
messages receivers would have accepted. Now sums body + attachments, default
25MB, before encoding.

**`MAX_RECIPIENTS_PER_MESSAGE=100` was validated, not changed.** It matches
Google's documented limit for SMTP and API submission exactly.

---

## Mock-data sweep

Searched production code (excluding `*.spec.ts`) for `mock`, `fake`, `dummy`,
`stub`, `lorem`, `sample data`, `hardcoded`, `TODO`, `FIXME`, `XXX`, `HACK`.

**Result: zero hits in production behaviour.** Every match is prose *about*
not faking things, or a lucide icon named `ListTodo`. Every `setTimeout` in the
composer is a debounce or a dismissal timer — none simulates progress.

---

## Honest summary

The composer is a working mail client, not a shell: recipients, drafts, rich
text, attachments and send are all real and verified end to end against an SMTP
server.

The largest genuine gaps, in the order worth closing:

1. **Reopening a draft.** Drafts persist correctly but cannot be resumed —
   arguably the most user-visible omission.
2. **Undo/redo and the wider toolbar.** Browser undo works inside the editor;
   there are no buttons.
3. **Signature.** Table exists, nothing reads it.
4. **Reply/forward.** The data model is ready; no UI enters the mode.
5. **Retry on send failure.** The draft survives, but the affordance is
   "press Send again".

Everything in `NOT IMPLEMENTED` is absent from the UI as well as the backend.
No dead buttons.
