# Security model

What is enforced, where, and which threat each control answers. Controls marked
**not built** are named rather than omitted — a security page that lists only
what exists reads as a claim of completeness.

## Authentication

| Control | Detail |
|---|---|
| Password hashing | scrypt, N=2^15, r=8, p=1. `maxmem` is set to `128·N·r·2` because the defaults sit exactly at the limit and fail on overhead |
| Password policy | Length, not composition. Composition rules push users toward predictable substitutions |
| Session tokens | 32 bytes from a CSPRNG, stored as SHA-256. A database read does not yield usable sessions |
| Cookies | `httpOnly`, `sameSite`, and `secure` in production |
| Login rate limit | Per address, per window |

**Not built:** MFA, OIDC/SAML, key rotation, rate limiting on endpoints other
than login, account lockout, password-breach checking.

## Authorisation

Every query is scoped by `userId` at the data layer, not by a filter applied
afterwards. `lib/server/mail.ts` takes `userId` in every function signature —
the scoping cannot be forgotten at a call site because there is no unscoped
variant to call.

For attachments, **ownership is part of the lookup**. Changing an id in a URL
returns `404`, not `403`: a `403` confirms the object exists, which is a
disclosure in itself.

Storage federation uses the three-layer model in
[ADR-0004](adr/0004-external-storage-federation.md):

```
effective = tenant ∧ mount ∧ provider
```

Each layer can only remove access. `storage.spec.ts` walks all five mount roles
against a fully-denying provider grant and asserts denial in every case. **This
property must not regress.**

## File handling

The threat is a file that claims to be one thing and is another.

| Control | Detail |
|---|---|
| Type detection | Magic bytes. The browser's `Content-Type` is recorded as a *claim* and never trusted |
| Filename sanitising | Codepoint filter, not a regex. `../../../etc/passwd` becomes `passwd` |
| Disposition | HTML and SVG are **never** served inline from this origin — both execute script in a same-origin context |
| Size cap | Enforced **during** the stream, so an oversized upload is aborted rather than measured after it lands |
| Storage paths | Path-escape check before any write |
| Text sniffing | `TextDecoder` with `fatal: true`, with a multi-byte boundary trim, so binary is not mistaken for text |

Verified over real HTTP: an EXE renamed to `.pdf` is detected as
`application/x-msdownload`; `../../../etc/passwd` is stored as `passwd`; a
cross-user attachment id returns `404`.

## Secrets

Provider credentials are AES-256-GCM sealed with the connection row id as AAD —
see [ADR-0005](adr/0005-provider-credential-security.md). The properties that
matter:

- A dump of `storage_connections` is not a working credential set.
- A ciphertext moved between rows **fails to decrypt**, which defeats the swap
  attack that would re-point one tenant's mount at another tenant's credentials.
- Every decryption failure returns one identical message, so the endpoint is not
  an oracle.
- `deriveKey` refuses material under 32 characters rather than stretching a weak
  secret and presenting it as strong.

**Never** log a refresh token, access token, S3 secret, private key or password.
**Never** expose a provider secret to frontend JavaScript — the browser holds a
session cookie against our own API and nothing else.

**Not built:** key rotation. `SECRETS_KEY` compromise currently means
re-authorising every connection.

## Transport and headers

Set in `apps/web/next.config.mjs` for every route:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | camera, microphone, geolocation, interest-cohort all denied |

### On `'unsafe-eval'`

React's **development** build uses `eval()` to reconstruct call stacks across
the server/client boundary, so a dev CSP without `'unsafe-eval'` breaks the app
with a console error. It is therefore added **in development only**:

```js
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
```

The CSP was **not** weakened globally to silence a console message. Verified
2026-08-20: the production client bundle contains **zero `eval` call sites**
across all 11 chunks. The issue is development-only and framework-caused.

`'unsafe-inline'` for scripts remains a real weakness — it is present because
Next.js injects inline bootstrap scripts, and removing it requires
nonce-based CSP with a custom document. **Not built**, and recorded here rather
than glossed.

## Email-specific

**Not built, and the reason matters.** The reading pane currently shows the
server's plain-text preview and says so. Untrusted HTML will not be rendered
until the whole pipeline exists: sanitise → block remote images → strip trackers
→ sandboxed iframe with its own `srcdoc` CSP. Rendering untrusted HTML with a
partial pipeline is worse than not rendering it, because it looks finished.

SPF/DKIM/DMARC verdicts are modelled in `packages/types/src/mail.ts` and
displayed per mechanism with a banner naming which check failed — but nothing
produces those verdicts yet, because no mail is received. Stalwart will
(ADR-0007).

## Data integrity

- Migrations are checksummed with SHA-256 and the runner **aborts if an applied
  migration was edited**.
- `storage_mounts.visibility` defaults to `private` **in the schema**, in both
  Postgres and SQLite — not only in application code.
- `storage_items` is keyed `UNIQUE (connection_id, external_id)`. The provider's
  id is never a primary key; two providers will eventually collide on one, and a
  shared key space is a cross-connection read.

## Reporting

This is pre-release software with no deployment. There is no security contact
process yet, and claiming one would be worse than saying so.
