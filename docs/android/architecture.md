# Android architecture

## The one sentence that explains the rest

**The Android app is a client of the existing Mail Server. The backend is the
source of truth, and there is no second mail backend.**

Every list, count, action and storage figure resolves to `apps/web/app/api/*`.
Nothing is computed locally that the server already knows, and nothing is
displayed that the server did not send.

## Layers

```
Compose UI          screens, rows, gestures
      ↓
ViewModel           UI state, debounce, event emission
      ↓
MailRepository      the only thing that talks to the server
      ↓
MailServerApi       Retrofit interface — every path exists in apps/web
      ↓
Mail Server         Next.js API routes
```

There is no use-case layer today. The brief allows for one, but the ViewModels
are thin and each calls one or two repository methods; a pass-through layer
between them would be indirection with nothing in it. It becomes worth adding
when a single user action needs to coordinate several repository calls with
rules of its own — the send path in `ComposeViewModel` is the first place
approaching that.

## Why there is no DI framework

`MailServerApp` is a hand-rolled composition root. The graph is four objects
deep, and Hilt at this size costs an annotation processor and a build-time hit
for indirection nobody needs yet.

Every consumer already asks the Application for its dependencies rather than
constructing them, so this is the seam where Hilt goes in if the graph grows
past what a reader can hold.

## State, and the one rule about it

**Nothing is applied locally.** Every action goes to the server and the list is
re-read from what came back. There is no optimistic mutation of visible rows.

That is a deliberate trade — it costs a round trip on every star — and it buys
the property that the app can never show a state the server rejected. A star
that turns gold and stays gold after a rejected request is the app lying about
the account, and there is no amount of "it usually works" that makes that
acceptable in a mail client.

The one place this rule will have to bend is offline support, and the plan for
it is in `offline.md`: queued operations are shown **as queued**, never as done.

## Errors

`ApiResult<T>` is a sealed success-or-typed-failure. No exceptions cross the
repository boundary, so a ViewModel cannot forget to handle one.

`ApiError` is a closed set — `Unauthenticated`, `Forbidden`, `NotFound`,
`Conflict`, `RateLimited`, `BadRequest`, `Server`, `Network`, `Malformed`. Each
needs different UI: `Network` is retryable and `Forbidden` is not, `Conflict`
needs a decision from the user, and `Malformed` means this build is out of date
rather than that the server is broken. An open `Exception` would let a new
failure mode reach the UI as a generic message.

The server has one error envelope everywhere — `{ error: { code, message,
requestId } }` — and `ApiClient.classify` decodes it, so the message shown is
the server's own sentence, written for a person. A raw status code is never
shown and a stack trace can never arrive: `guard()` in `http.ts` makes sure of
that on the other side.

## Wire contracts

`data/model/*.kt` mirrors `packages/types` **field for field, with the
TypeScript names kept**. They are not renamed to Kotlin conventions, because
the wire format is the contract.

`ignoreUnknownKeys = true` lets the server add a field without breaking
installed clients. Fields have defaults **only** where the contract genuinely
allows them to be absent — a default that papers over a missing required field
turns a broken response into a silently wrong screen.

## Shared policy, mirrored deliberately

`ui/mail/MailPolicy.kt` is a hand-maintained port of
`apps/web/components/mail-selection.ts`: what Delete means per mailbox, which
actions each mailbox offers, the undo inverses, the empty-state wording.

Duplication is the deliberate choice. The alternative — serving the policy from
the API — puts a network round trip in front of drawing a toolbar, and a client
that cannot reach the server then cannot decide whether its own Delete button is
safe. So both sides state it, and **both sides test it**:
`mail-selection.spec.ts` and `MailPolicyTest.kt` assert the same table.

Changing one without the other is a product bug even when both builds pass.

## Threading

Everything is coroutines. `ApiClient.execute` wraps each call in
`withContext(Dispatchers.IO)`, so no ViewModel has to remember to. Cancellation
propagates — it is rethrown rather than caught — because a cancelled coroutine
reported to the user as a network error is a lie about what happened.

## Security posture in one place

- Session is an httpOnly cookie held by a persistent `CookieJar`, stored in
  Keystore-backed encrypted storage. See `security.md`.
- HTTP logging is `BASIC` in debug and **absent** in release. `BODY` would put
  message contents, addresses and the session cookie into logcat.
- Writes are never retried automatically. "Archive these 200 threads" applied
  twice is not the same as applied once, and the server exposes no idempotency
  key for actions — only for send, which uses one properly.

## Layout of the source

```
data/
  auth/        SessionStore, SessionCookieJar, PasskeySupport
  model/       wire types, mirroring packages/types
  remote/      ApiClient, MailServerApi, ApiResult
  MailRepository.kt
ui/
  auth/        sign in, register, passkey prompt
  compose/     the composer and its ViewModel
  inbox/       thread list, rows, selection
  mail/        MailPolicy (shared semantics), SwipeActions
  nav/         drawer, destinations
  haptics/     HapticFeedbackManager, ThresholdLatch
  theme/       tokens generated from packages/ui/src/theme.css
```

## What is not built yet

Tracked honestly in `navigation.md`. In short: conversation view, storage,
account/settings, offline, notifications, bottom navigation, tablet layouts.

Rows and buttons for those do not exist in the UI — a control that opens nothing
is a feature claim the app then disproves.
