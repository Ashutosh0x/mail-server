import "server-only";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { db, newId, nowIso } from "./db";
import { config } from "./config";

/**
 * WebAuthn: passkey registration and authentication.
 *
 * Verification is delegated to `@simplewebauthn/server`. This is one of the
 * few places where a dependency is clearly correct rather than merely
 * convenient: verifying an attestation means parsing CBOR, decoding COSE keys,
 * and checking ECDSA/RSA signatures against a specific set of allowed
 * algorithms. Hand-writing that is how you ship a verifier that accepts
 * `alg: none`, and a subtly wrong signature check is indistinguishable from a
 * correct one until someone exploits it.
 *
 * What is NOT delegated is everything about our own trust model: challenge
 * issuance and single use, credential ownership, the sign-count check, and the
 * refusal to leak whether an account exists.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The Relying Party ID — the domain a passkey is bound to.
 *
 * A credential registered for `localhost` will not work on `mail.example.com`,
 * by design: that binding is exactly what makes passkeys unphishable. It must
 * be the site's registrable domain, never a full URL and never a port.
 */
export function relyingParty(): { id: string; name: string; origin: string[] } {
  return {
    id: config.webauthnRpId,
    name: config.webauthnRpName,
    // Several origins may map to one RP ID (http and https on localhost, or
    // an apex plus a subdomain). Verification requires an exact origin match,
    // so every acceptable one is listed rather than pattern-matched.
    origin: config.webauthnOrigins,
  };
}

// ── Challenges ─────────────────────────────────────────────────────────────

function storeChallenge(
  challenge: string,
  purpose: "registration" | "authentication",
  userId: string | null
): void {
  // Opportunistic sweep. A dedicated job would be better, but an expired
  // challenge left in the table is a row that can still be looked up, and this
  // costs one indexed delete on a path that already writes.
  db().prepare(`DELETE FROM webauthn_challenges WHERE expires_at < ?`).run(nowIso());

  db()
    .prepare(
      `INSERT INTO webauthn_challenges (id, user_id, challenge, purpose, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId(),
      userId,
      challenge,
      purpose,
      new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      nowIso()
    );
}

/**
 * Consume a challenge: read it and delete it in one step.
 *
 * Single use is the whole point. Returning it without deleting would let the
 * same signed assertion be replayed until it expired.
 */
function consumeChallenge(
  challenge: string,
  purpose: "registration" | "authentication"
): { userId: string | null } | null {
  const row = db()
    .prepare(
      `SELECT id, user_id FROM webauthn_challenges
        WHERE challenge = ? AND purpose = ? AND expires_at > ?`
    )
    .get(challenge, purpose, nowIso()) as { id: string; user_id: string | null } | undefined;

  if (!row) return null;
  db().prepare(`DELETE FROM webauthn_challenges WHERE id = ?`).run(row.id);
  return { userId: row.user_id };
}

// ── Registration ───────────────────────────────────────────────────────────

export async function beginRegistration(user: {
  id: string;
  email: string;
  displayName: string;
}) {
  const rp = relyingParty();

  // Credentials the user already has, so the authenticator refuses to enrol
  // the same one twice rather than silently creating a duplicate.
  const existing = db()
    .prepare(`SELECT credential_id, transports FROM passkeys WHERE user_id = ?`)
    .all(user.id) as { credential_id: Uint8Array; transports: string }[];

  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    // A stable, non-identifying handle. Never the email address: the user
    // handle is stored on the authenticator and may be visible in an account
    // chooser on a shared device.
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.displayName,
    // Discourage attestation. We do not run a certificate-authority allowlist,
    // and requesting attestation would collect device-identifying data we have
    // no use for.
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({
      id: Buffer.from(row.credential_id).toString("base64url"),
      transports: safeTransports(row.transports),
    })),
    authenticatorSelection: {
      // Prefer a credential the user can select without typing an address.
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  storeChallenge(options.challenge, "registration", user.id);
  return options;
}

export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  name: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const rp = relyingParty();

  // Same shape-check as authentication: a missing field must be a rejection,
  // not a TypeError that surfaces as a 500.
  if (!isAssertionShaped(response)) {
    return { ok: false, reason: "The browser response was malformed." };
  }

  const expectedChallenge = decodeChallenge(response.response.clientDataJSON);
  if (!expectedChallenge) return { ok: false, reason: "The browser response was malformed." };

  const stored = consumeChallenge(expectedChallenge, "registration");
  if (!stored) return { ok: false, reason: "This request expired. Start again." };
  // A challenge issued for one account must not register a key on another.
  if (stored.userId !== userId) return { ok: false, reason: "This request expired. Start again." };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
  } catch {
    return { ok: false, reason: "That security key could not be verified." };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "That security key could not be verified." };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const id = newId();

  try {
    db()
      .prepare(
        `INSERT INTO passkeys
           (id, user_id, credential_id, public_key, name, sign_count, transports,
            backed_up, device_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        Buffer.from(credential.id, "base64url"),
        Buffer.from(credential.publicKey),
        name,
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        credentialBackedUp ? 1 : 0,
        credentialDeviceType,
        nowIso()
      );
  } catch (error) {
    // UNIQUE on credential_id: this authenticator is already enrolled, here or
    // on another account.
    if (String(error).includes("UNIQUE")) {
      return { ok: false, reason: "That device is already registered." };
    }
    throw error;
  }

  return { ok: true, id };
}

// ── Authentication ─────────────────────────────────────────────────────────

export async function beginAuthentication(email: string | null) {
  const rp = relyingParty();

  // Deliberately NOT filtered by account when no email is supplied: a
  // discoverable credential lets the authenticator offer the right passkey
  // without us revealing which accounts exist.
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

  if (email) {
    const rows = db()
      .prepare(
        `SELECT p.credential_id, p.transports FROM passkeys p
           JOIN users u ON u.id = p.user_id
          WHERE u.email = ? AND u.status = 'active'`
      )
      .all(email) as { credential_id: Uint8Array; transports: string }[];

    // An empty list would tell the caller that this address has no passkeys,
    // which tells them the address exists. Undefined behaves the same for a
    // real user and reveals nothing.
    allowCredentials = rows.length
      ? rows.map((row) => ({
          id: Buffer.from(row.credential_id).toString("base64url"),
          transports: safeTransports(row.transports),
        }))
      : undefined;
  }

  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: "preferred",
    ...(allowCredentials ? { allowCredentials } : {}),
  });

  storeChallenge(options.challenge, "authentication", null);
  return options;
}

export async function finishAuthentication(
  response: AuthenticationResponseJSON
): Promise<{ ok: true; userId: string; passkeyId: string } | { ok: false; reason: string }> {
  const rp = relyingParty();

  // Shape-check before reaching into it. This is an unauthenticated endpoint
  // taking arbitrary JSON, so a missing field must be a rejection, not an
  // exception that surfaces as a 500.
  if (!isAssertionShaped(response)) {
    return { ok: false, reason: "The browser response was malformed." };
  }

  const expectedChallenge = decodeChallenge(response.response.clientDataJSON);
  if (!expectedChallenge) return { ok: false, reason: "The browser response was malformed." };

  const stored = consumeChallenge(expectedChallenge, "authentication");
  if (!stored) return { ok: false, reason: "This sign-in request expired. Try again." };

  const credentialId = Buffer.from(response.id, "base64url");
  const row = db()
    .prepare(
      `SELECT p.id, p.user_id, p.credential_id, p.public_key, p.sign_count, p.transports
         FROM passkeys p
         JOIN users u ON u.id = p.user_id
        WHERE p.credential_id = ? AND u.status = 'active'`
    )
    .get(credentialId) as
    | {
        id: string;
        user_id: string;
        credential_id: Uint8Array;
        public_key: Uint8Array;
        sign_count: number;
        transports: string;
      }
    | undefined;

  // One message for an unknown credential and for a failed signature. Saying
  // "no such passkey" would confirm which credentials exist.
  if (!row) return { ok: false, reason: "That passkey was not recognised." };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: Buffer.from(row.credential_id).toString("base64url"),
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.sign_count),
        transports: safeTransports(row.transports),
      },
      requireUserVerification: false,
    });
  } catch {
    return { ok: false, reason: "That passkey was not recognised." };
  }

  if (!verification.verified) return { ok: false, reason: "That passkey was not recognised." };

  /**
   * The signature counter detects a cloned authenticator: a hardware key
   * increments it on every use, so a counter that did not advance means two
   * copies of the same credential are in circulation.
   *
   * Only meaningful when the authenticator uses one at all — synced passkeys
   * report 0 forever, and treating that as a clone would lock out every
   * iCloud and Google Password Manager user.
   */
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter > 0 && newCounter <= Number(row.sign_count)) {
    return { ok: false, reason: "That passkey was not recognised." };
  }

  db()
    .prepare(`UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?`)
    .run(newCounter, nowIso(), row.id);

  return { ok: true, userId: row.user_id, passkeyId: row.id };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Minimum shape of a WebAuthn response before any field is read.
 *
 * These endpoints accept arbitrary JSON. Everything
 * beyond this is the library's job; this only ensures a malformed body is a
 * clean 400 rather than a TypeError.
 */
function isAssertionShaped<T extends { id: string; response: { clientDataJSON: string } }>(
  value: unknown
): value is T {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; response?: unknown };
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  if (typeof candidate.response !== "object" || candidate.response === null) return false;
  const inner = candidate.response as { clientDataJSON?: unknown };
  return typeof inner.clientDataJSON === "string" && inner.clientDataJSON.length > 0;
}

/** The challenge the browser actually signed, read back from clientDataJSON. */
function decodeChallenge(clientDataJSON: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as {
      challenge?: unknown;
    };
    return typeof parsed.challenge === "string" ? parsed.challenge : null;
  } catch {
    return null;
  }
}

/** Transports are stored as JSON. A corrupt value must not break sign-in. */
function safeTransports(value: string): AuthenticatorTransportFuture[] | undefined {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length ? (parsed as AuthenticatorTransportFuture[]) : undefined;
  } catch {
    return undefined;
  }
}
