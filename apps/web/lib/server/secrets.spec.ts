import { describe, expect, it } from "vitest";
import { deriveKey, openSecret, redact, safeEqual, sealSecret, SecretError } from "./secrets";

const KEY = deriveKey("a-development-key-that-is-long-enough-32+");
const OTHER_KEY = deriveKey("a-completely-different-key-also-long-enough");
const CONTEXT = "connection:11111111-1111-1111-1111-111111111111";

describe("deriveKey", () => {
  it("refuses a short or missing key rather than stretching a weak secret", () => {
    expect(() => deriveKey(undefined)).toThrow(SecretError);
    expect(() => deriveKey("")).toThrow(SecretError);
    expect(() => deriveKey("too-short")).toThrow(SecretError);
  });

  it("produces a 32-byte key for AES-256", () => {
    expect(KEY.length).toBe(32);
  });
});

describe("sealSecret / openSecret", () => {
  it("round-trips a credential", () => {
    const token = "1//0eXaMpLe-refresh-token-value";
    expect(openSecret(sealSecret(token, CONTEXT, KEY), CONTEXT, KEY)).toBe(token);
  });

  it("never emits the plaintext in the sealed form", () => {
    const token = "super-secret-refresh-token";
    const sealed = sealSecret(token, CONTEXT, KEY);
    expect(sealed).not.toContain(token);
    expect(sealed.startsWith("v1.")).toBe(true);
  });

  it("produces a different ciphertext every time for the same input", () => {
    // A fresh nonce per call. Identical ciphertexts would leak that two rows
    // hold the same credential.
    const a = sealSecret("same", CONTEXT, KEY);
    const b = sealSecret("same", CONTEXT, KEY);
    expect(a).not.toBe(b);
  });

  it("fails with the wrong key", () => {
    const sealed = sealSecret("token", CONTEXT, KEY);
    expect(() => openSecret(sealed, CONTEXT, OTHER_KEY)).toThrow(SecretError);
  });

  it("fails when the ciphertext is moved to another connection", () => {
    // The AAD binds a credential to its row. Copying the blob into a different
    // connection must not yield a working credential.
    const sealed = sealSecret("token", CONTEXT, KEY);
    expect(() => openSecret(sealed, "connection:22222222-2222-2222-2222-222222222222", KEY)).toThrow(SecretError);
  });

  it("fails when any byte is tampered with", () => {
    const sealed = sealSecret("token", CONTEXT, KEY);
    const parts = sealed.split(".");
    const payload = Buffer.from(parts[3]!, "base64url");
    payload[0] = payload[0]! ^ 0xff;
    parts[3] = payload.toString("base64url");
    expect(() => openSecret(parts.join("."), CONTEXT, KEY)).toThrow(SecretError);
  });

  it("fails when the auth tag is stripped or replaced", () => {
    const sealed = sealSecret("token", CONTEXT, KEY);
    const parts = sealed.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => openSecret(parts.join("."), CONTEXT, KEY)).toThrow(SecretError);
  });

  it("rejects a malformed record instead of throwing something unhelpful", () => {
    for (const bad of ["", "nonsense", "v1.only.three", "v2.a.b.c"]) {
      expect(() => openSecret(bad, CONTEXT, KEY), bad).toThrow(SecretError);
    }
  });

  it("gives one message for every failure, so it is not an oracle", () => {
    const sealed = sealSecret("token", CONTEXT, KEY);
    const wrongKey = (() => { try { openSecret(sealed, CONTEXT, OTHER_KEY); } catch (e) { return (e as Error).message; } })();
    const wrongContext = (() => { try { openSecret(sealed, "other", KEY); } catch (e) { return (e as Error).message; } })();
    expect(wrongKey).toBe(wrongContext);
  });

  it("handles unicode and long credentials", () => {
    const long = "ключ-" + "x".repeat(4096) + "-🔐";
    expect(openSecret(sealSecret(long, CONTEXT, KEY), CONTEXT, KEY)).toBe(long);
  });
});

describe("redact", () => {
  it("shows enough to identify a key and not enough to use it", () => {
    const redacted = redact("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).toContain("AKIA");
    expect(redacted).toContain("MPLE");
    expect(redacted).not.toContain("IOSFODNN7EXA");
  });

  it("reveals nothing at all for a short value", () => {
    expect(redact("short")).toBe("••••••••");
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal values correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    expect(safeEqual("a", "abcdef")).toBe(false);
  });
});
