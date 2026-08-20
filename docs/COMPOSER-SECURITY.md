# Composer security

Every control, the threat it answers, and where it is enforced.

## The enforcement rule

**Every control is server-side.** The composer re-checks some of the same
things, but only so a user learns about a problem before waiting for a 100MB
upload — never as the boundary. Anything can POST to these APIs directly.

## Header injection

The threat: a newline in a display name, subject or address closes the header
and opens a new one. `Ada\r\nBcc: victim@example.com` silently adds a blind
copy the sender never wrote.

Refused in `lib/server/mime.ts` for CR, LF, **U+2028, U+2029** (treated as line
terminators by some JSON and JavaScript paths) and NUL (truncates in any
C-based MTA downstream). Every header value passes `assertHeaderSafe` before it
is written; the API layer refuses the same characters earlier so the error can
name the field.

Covered by tests asserting refusal in display names, subjects, addresses,
`In-Reply-To` and `References`.

## HTML injection and XSS

Sanitised on the way **in**, so the stored value is already safe — and the
stored value is what gets sent.

Allow-list, never a block-list. A block-list is a promise to have thought of
every dangerous tag, and HTML keeps adding them. Absent by design:

| Excluded | Why |
|---|---|
| `script`, `iframe`, `object`, `embed`, `form` | Executable or interactive |
| `style` and all inline styles | CSS is an exfiltration and obfuscation channel |
| `svg`, `math` | Parser-confusion (mXSS) vectors |

URL schemes are limited to `http`, `https`, `mailto`, `tel`, plus `cid:` on
images only. `javascript:` is the obvious exclusion; `data:` is excluded too,
because `data:text/html` is a same-origin script in a link.

Sanitisation runs **twice**. Mutation-XSS works by producing markup that is
harmless on one parse and dangerous after the browser re-parses the serialised
output, so the stored value must be a fixed point. A test asserts idempotence
against known mXSS payloads.

## Blind copies

`Bcc` appears in the SMTP envelope and **nowhere in the headers**. That
separation is the entire mechanism by which a blind copy is blind, and a test
fails if the address ever reaches the message body.

## Sender authorisation

`From` is never taken from the request. `authorizedSenders()` returns the
user's own address plus enabled aliases, and a send naming anything else is
refused with 403. A From the client can choose is a From anyone can forge —
which is precisely what SPF, DKIM and DMARC exist downstream to prevent.

## Attachment authorisation

Binding an attachment id to a draft scopes the update by `user_id`, so an id
stolen from another account attaches nothing. Type is decided from **magic
bytes**; the browser's `Content-Type` is stored as a claim and surfaced when
the two disagree.

## Idempotency

`Idempotency-Key` on send. The column is `UNIQUE`, so the guarantee is the
database's rather than a race-prone check-then-act. A double-clicked Send or a
retried request returns the original result rather than sending twice.

## Draft isolation

Every draft query carries `user_id` in the WHERE clause, so another user's
draft id reads, writes and deletes **zero rows** and returns 404 — not 403,
which would confirm the draft exists.

## Transport

`requireTLS` makes an SMTP connection **fail** rather than silently downgrade
to plaintext. A quiet downgrade is worse than a refusal, because nobody
notices mail leaving in the clear. `SMTP_ALLOW_INSECURE` lifts it deliberately
for relaying to a trusted MTA on loopback, and is off by default.

## Not addressed

- **No malware scanning.** Attachments are type-checked, not scanned. There is
  no ClamAV in this environment, and no state pretends otherwise.
- **No DLP or external-recipient warnings.** There is no classification
  system, so no warning is shown. A warning with no rule behind it teaches
  people to dismiss warnings.
- **No rate limiting on send** beyond the recipient cap.
- **No encryption claims.** Mail leaves over TLS when the server offers it.
  Nothing here is end-to-end encrypted, and nothing says it is.
