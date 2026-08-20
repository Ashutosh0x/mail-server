# Android security

## Session handling

**Authentication is an httpOnly cookie. There is no bearer-token path**, and
none was added for Android — see §1 of `api-integration.md` for why that is not
a blocker.

| Property | Value |
|---|---|
| Cookie | `mf_session`, 32 random bytes base64url |
| Stored on device | Keystore-backed encrypted storage, via `SessionStore` |
| Replayed by | `SessionCookieJar`, a persistent OkHttp `CookieJar` |
| Lifetime | Server-controlled, default 30 days |

The token is **bearer-equivalent once extracted**. It never touches plain
`SharedPreferences`, is never logged, and never appears in a crash report.

### The stored cookie is only a hint

`resolveSession()` always asks the server who we are rather than trusting local
state. A session revoked from another device is still present on disk here, and
treating it as valid would show a signed-in shell that fails on every request.

Only an **explicit 401** signs the user out. A network failure must not: losing
signal would otherwise destroy the session and any unsent work with it.

Sign-out clears local state **even when the server call fails**. Someone who
asked to sign out on a train with no signal must not stay signed in on the
device; the server-side session is revoked on the next successful call or
expires on its own.

## Logging

The OkHttp interceptor runs at `BASIC` in debug builds and is **absent** in
release.

`BODY` level would put message contents, recipient addresses and the session
cookie into logcat — readable by anyone with the phone plugged in. No amount of
"it is only debug" makes that safe on a shared or lost device.

Nothing else logs message bodies, addresses, tokens, attachment contents or
authentication secrets.

## Transport

| Build | Cleartext | User CAs trusted |
|---|---|---|
| Release (`src/main`) | **No** | **No** |
| Debug (`src/debug`) | Yes | Yes |

Release trusts only system CAs. Trusting user-installed certificates in a
shipping build would let anyone who can add a certificate to the device read a
real account's mail.

Debug permits both so a local server over plain HTTP works and a proxy such as
mitmproxy can inspect traffic. It is scoped to `src/debug` and never reaches a
release APK.

`MAILSERVER_BASE_URL_RELEASE` has **no default**, so a release build with no
HTTPS URL fails to build rather than silently falling back to plain HTTP. The
server reinforces this independently: the session cookie is issued with `secure`
set when `NODE_ENV=production`, so a production server would refuse to keep a
session over cleartext regardless.

## Retries

Writes are **never** retried automatically.

OkHttp's `retryOnConnectionFailure` only re-attempts connection-level failures,
which is safe. Application-level retry of a POST is not: "archive these 200
threads" applied twice is not the same as applied once, and the actions endpoint
exposes no idempotency key.

**Send is the exception, and it does it properly.** One `Idempotency-Key` is
generated per send *attempt* and **kept across retries of that attempt**, so a
request that timed out but actually succeeded returns the original result rather
than sending the message twice. Regenerating the key on retry would defeat the
entire mechanism, which is why `ComposeViewModel` holds it rather than minting
one at the call site.

## Passkeys

Implemented against the existing `/api/auth/passkey/challenge` and
`/api/auth/passkey`. The server's WebAuthn options pass through as **raw JSON**,
untouched — the fields are base64url and their exact encoding is what the
signature covers, so a round trip through a hand-written model is a chance to
change a byte that must not change.

The affordance is shown only where it can succeed. `PasskeySupport` checks:

1. API 28+
2. The base URL is HTTPS (or `localhost`, trustworthy by definition)
3. The host is a registrable domain — an IP literal cannot be an RP ID

This mirrors the web client's `window.isSecureContext` check, and for the same
stated reason: *the button never appears where it could only fail*.

### The requirement the app cannot check

Android's Credential Manager additionally requires **Digital Asset Links**: the
server must serve `https://<rpId>/.well-known/assetlinks.json` naming this app's
package and signing-certificate fingerprint.

```json
[{
  "relation": ["delegate_permission/common.get_login_creds"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.mailserver.android",
    "sha256_cert_fingerprints": ["<your release signing fingerprint>"]
  }
}]
```

This is unverifiable from inside the app before the fact — the failure surfaces
only when the call is made — so it is documented rather than guessed at. Get the
fingerprint with:

```bash
keytool -list -v -keystore <release.jks> -alias <alias>
```

`WEBAUTHN_RP_ID` on the server must match the domain serving that file.

**Consequence today:** a debug build pointed at `http://192.168.x.x:3000` hides
the passkey button entirely. That is correct behaviour, not a bug.

## Password reset

**There is none, on any client.**

The server has no reset endpoint, and the web sign-in screen offers no such
link. Android therefore shows no "Forgot password" button, because it would lead
nowhere.

Implementing it is real backend work — a reset-token table with expiry and
single-use semantics, plus email delivery — and belongs in `apps/web` first so
both clients get it.

## HTML message bodies

**Not rendered, on either client.**

`apps/web/components/reading-pane.tsx` shows the server's plain-text preview and
says so. Sanitisation itself exists (`lib/server/sanitize.ts`, allow-list based,
22 tests) and every *outgoing* body passes through it. What is missing is the
rest of the read path: remote-image blocking, tracker stripping, and an isolated
frame to render in.

Sanitised HTML injected into a page still leaks a read receipt to every remote
image on load. Android will match the web here — plain-text preview until those
three exist — rather than introducing an Android-specific rendering path that
the web deliberately does not have. A `WebView` with `loadData` and default
settings would be exactly the XSS-and-tracking surface §47 rules out.

## Attachments

Uploads stream from the content resolver straight to the socket and are never
buffered into a `ByteArray`. The server's limit is 100MB; loading that into heap
on a phone is an `OutOfMemoryError`, not a slow upload.

Filenames are percent-encoded before going into the `X-Filename` header. A
filename is user-controlled, and a header value cannot carry a newline — this is
header-injection defence, not tidiness.

Names and sizes come from the provider's metadata via `resolvePickedFile`. A
provider that will not say what a file is called is reported as a failure rather
than given a placeholder: sending an attachment named "file" when the user
picked "contract-final.pdf" is a silent corruption of what they meant to send.

## Authorization is the server's job

The client's list of ids is never trusted **by the server** — `applyAction` and
`deleteMessages` both carry `user_id` in their WHERE clauses, so an id belonging
to another account matches nothing.

The app reads `changed` against `requested` from the response and reports a
partial result as partial. Saying "Archived" when eight of ten were archived is
the app claiming an outcome it was explicitly told did not happen.

## Backups

**Nothing leaves the device through backup.** `allowBackup="false"`,
`fullBackupContent="false"`, and `data_extraction_rules.xml` excludes every
domain — `root`, `database`, `sharedpref` and `file` — for both cloud backup and
device transfer.

Two reasons, and the second is the one people miss:

- A backup is an unencrypted copy of a mailbox sitting in someone's cloud
  account.
- A **session** restored onto a different device is a session that device never
  authenticated. Excluding the encrypted store is what stops a device transfer
  from silently handing over a live login.
