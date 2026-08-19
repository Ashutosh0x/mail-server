import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for provider credentials at rest.
 *
 * OAuth refresh tokens, S3 secret keys and SSH private keys all end up in one
 * column. A database dump must not be a working set of credentials for a
 * customer's Google Drive, so the column holds ciphertext and the key lives in
 * the environment.
 *
 * AES-256-GCM: authenticated, so a tampered row fails to decrypt rather than
 * silently yielding attacker-chosen bytes. The AAD binds each ciphertext to the
 * connection it belongs to — moving a blob from one row to another breaks the
 * tag, which stops a swap attack from re-pointing one tenant's mount at
 * another tenant's credentials.
 *
 * Not marked `server-only`: it is pure crypto over strings, and marking it
 * would make it untestable outside a server component for no benefit. It
 * imports nothing that touches a request.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the GCM standard nonce size
const TAG_BYTES = 16;
const VERSION = "v1";

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

/**
 * Derive the 32-byte key from `SECRETS_KEY`.
 *
 * SHA-256 of the configured value rather than a KDF with a salt: the input is
 * expected to be high-entropy already (generate it with `openssl rand -base64
 * 32`), and a per-record salt would have to be stored beside the ciphertext
 * anyway. If the value is short we refuse rather than stretch a weak secret and
 * pretend it is strong.
 */
export function deriveKey(material: string | undefined): Buffer {
  if (!material || material.length < 32) {
    throw new SecretError(
      "SECRETS_KEY must be set to at least 32 characters. Generate one with: openssl rand -base64 32"
    );
  }
  return createHash("sha256").update(material, "utf8").digest();
}

/**
 * Encrypt a credential.
 *
 * Output layout: `v1.<iv>.<tag>.<ciphertext>`, all base64url. Versioned so a
 * future algorithm change can decrypt old rows instead of orphaning them.
 */
export function sealSecret(plaintext: string, context: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  // Bind the ciphertext to its row. Decryption with a different context fails.
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Decrypt a credential. Throws on any tampering, truncation or wrong context. */
export function openSecret(sealed: string, context: string, key: Buffer): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretError("Stored credential is not in a recognised format.");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const payload = Buffer.from(parts[3]!, "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretError("Stored credential has an invalid nonce or tag.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    // One message for every failure mode. Distinguishing "wrong key" from
    // "tampered" from "wrong context" tells an attacker which knob to turn.
    throw new SecretError("Stored credential could not be decrypted.");
  }
}

/**
 * Redact a credential for display.
 *
 * Never returns enough to reconstruct the value. Used wherever the UI must show
 * *which* key is configured without showing the key.
 */
export function redact(value: string): string {
  if (value.length <= 8) return "•".repeat(8);
  return `${value.slice(0, 4)}${"•".repeat(8)}${value.slice(-4)}`;
}

/** Constant-time comparison, for webhook signatures and API keys. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length is not secret, but comparing different lengths would throw.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
