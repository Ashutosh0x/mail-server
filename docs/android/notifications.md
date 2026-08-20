# Notifications

## Status: not implemented, and blocked on the backend

**The server has no push infrastructure.** There is no FCM registration
endpoint, no device-token table and no push send path anywhere in
`apps/web/app/api`.

§25 is explicit about what to do in that situation: implement the client
abstraction, document the backend dependency, and **do not simulate push
notifications**. So there are none in the app — not a polling loop dressed up as
push, and no notification settings screen offering choices nothing can enforce.

## What the backend needs first

1. **A device-token endpoint.** `POST /api/account/devices` to register an FCM
   token against the session's user, `DELETE` to revoke on sign-out. Tokens
   rotate, so re-registration must be idempotent.

2. **A send path on message arrival.** The point where a message is stored is
   the point where a push fires. It must respect the account's notification
   preferences **server-side** — a client that filters after delivery has
   already received the content it was meant not to see.

3. **A preferences shape.** `/api/account/preferences` already exists;
   notification preferences would extend it. §26 is the constraint: *only expose
   options that can be enforced correctly*. "Important mail only" needs a
   server-side notion of important; without one, offering it is a setting that
   does nothing.

## What the client will need

- `POST_NOTIFICATIONS` runtime permission (API 33+), requested at a moment when
  the reason is obvious — not on first launch, before the user has seen a
  mailbox.
- A notification channel per category, so one kind can be silenced without
  silencing all.
- A deep link to the **exact** conversation: `mailserver://message/{id}` plus
  HTTPS app links, verified with Digital Asset Links — the same
  `assetlinks.json` the passkey work needs (see `security.md`).
- Actions — Mark read, Archive, Delete — going through the same
  `/api/mail/actions` path the UI uses, never a parallel implementation.

## The privacy rule

§25 and §26 require preview control: **Full / Sender + subject / No preview**.

A lock-screen notification is visible to anyone holding the phone. Whatever the
default, it must be enforced where the notification is **built**, and ideally
where it is **sent**: a payload containing the message body has already left the
server, and a client that chooses not to display it has not protected anything.
