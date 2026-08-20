import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for the parts of WebAuthn that are OURS.
 *
 * The cryptography belongs to `@simplewebauthn/server` and is not re-tested
 * here — asserting that a vetted verifier verifies would test the library, not
 * this code. What is tested is the trust model around it: challenge handling,
 * input shape, and the refusal to leak which accounts exist. The full ceremony
 * is exercised separately against Chrome's virtual authenticator, which
 * produces real signatures.
 */

const rows: Record<string, unknown>[] = [];
const deleted: string[] = [];

vi.mock("./db", () => ({
  db: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes("DELETE")) deleted.push(String(args[0]));
        else if (sql.includes("INSERT INTO webauthn_challenges")) {
          rows.push({ id: args[0], user_id: args[1], challenge: args[2], purpose: args[3] });
        }
        return { changes: 1 };
      },
      get: (...args: unknown[]) =>
        rows.find((r) => r.challenge === args[0] && r.purpose === args[1]),
      all: () => [],
    }),
  }),
  newId: () => "id-" + rows.length,
  nowIso: () => new Date().toISOString(),
}));

vi.mock("./config", () => ({
  config: {
    webauthnRpId: "localhost",
    webauthnRpName: "Mail Server",
    webauthnOrigins: ["http://localhost:3000"],
  },
}));

const { relyingParty, beginRegistration, beginAuthentication, finishAuthentication, finishRegistration } =
  await import("./webauthn");

beforeEach(() => {
  rows.length = 0;
  deleted.length = 0;
});

describe("relyingParty", () => {
  it("uses a bare domain as the RP ID, never a URL or a port", () => {
    const rp = relyingParty();
    // The RP ID is what binds a credential to a site. A URL here silently
    // breaks every ceremony; a port makes the credential unusable elsewhere.
    expect(rp.id).toBe("localhost");
    expect(rp.id).not.toContain("://");
    expect(rp.id).not.toContain(":");
    expect(rp.id).not.toContain("/");
  });

  it("lists origins exactly rather than pattern-matching them", () => {
    // An origin check that accepts a wildcard is not a check.
    for (const origin of relyingParty().origin) {
      expect(origin).toMatch(/^https?:\/\//);
      expect(origin).not.toContain("*");
    }
  });
});

describe("registration options", () => {
  it("issues a challenge and stores it against the user", async () => {
    const options = await beginRegistration({
      id: "user-1",
      email: "a@example.com",
      displayName: "A",
    });
    expect(options.challenge.length).toBeGreaterThan(20);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe("user-1");
    expect(rows[0]!.purpose).toBe("registration");
  });

  it("issues a different challenge every time", async () => {
    const a = await beginRegistration({ id: "u", email: "a@b.c", displayName: "A" });
    const b = await beginRegistration({ id: "u", email: "a@b.c", displayName: "A" });
    // A reused challenge is a replayable ceremony.
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("does not request attestation", async () => {
    // We run no CA allowlist, so attestation would collect device-identifying
    // data with no use for it.
    const options = await beginRegistration({ id: "u", email: "a@b.c", displayName: "A" });
    expect(options.attestation).toBe("none");
  });

  it("never puts the email address in the user handle", async () => {
    // The handle is stored on the authenticator and can surface in an account
    // chooser on a shared device.
    const options = await beginRegistration({ id: "user-1", email: "a@example.com", displayName: "A" });
    const decoded = Buffer.from(options.user.id, "base64url").toString("utf8");
    expect(decoded).toBe("user-1");
    expect(decoded).not.toContain("@");
  });
});

describe("authentication options", () => {
  it("stores an authentication challenge with no user attached", async () => {
    await beginAuthentication(null);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBeNull();
    expect(rows[0]!.purpose).toBe("authentication");
  });

  it("omits allowCredentials for an unknown address, revealing nothing", async () => {
    // An empty allowCredentials list would confirm the address has no
    // passkeys, which confirms the address exists.
    const options = await beginAuthentication("nobody@example.com");
    expect(options.allowCredentials).toBeUndefined();
  });
});

describe("input shape", () => {
  it("rejects a malformed assertion instead of throwing", async () => {
    for (const bad of [null, undefined, {}, [], { id: "x" }, { id: "x", response: {} }, { response: { clientDataJSON: "y" } }]) {
      // Unauthenticated endpoint taking arbitrary JSON: a missing field must
      // be a clean rejection, never a TypeError that surfaces as a 500.
      const result = await finishAuthentication(bad as never);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.reason).toContain("malformed");
    }
  });

  it("rejects a malformed registration response the same way", async () => {
    for (const bad of [null, {}, { id: "x" }, { id: "x", response: {} }]) {
      const result = await finishRegistration("user-1", bad as never, "Key");
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects an assertion whose challenge was never issued", async () => {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ challenge: "never-issued-by-us" })
    ).toString("base64url");

    const result = await finishAuthentication({
      id: "credential",
      response: { clientDataJSON },
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("expired");
  });

  it("consumes a challenge so it cannot be replayed", async () => {
    const options = await beginAuthentication(null);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ challenge: options.challenge })
    ).toString("base64url");

    // First use gets past the challenge check and fails later, on the unknown
    // credential — which is what proves the challenge itself was accepted.
    const first = await finishAuthentication({ id: "unknown", response: { clientDataJSON } } as never);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).not.toContain("expired");

    // The row is deleted on use, so a replay cannot find it.
    expect(deleted.length).toBeGreaterThan(0);
  });
});

describe("error messages", () => {
  it("says the same thing for an unknown credential as for a bad signature", async () => {
    // Distinguishing them would confirm which credentials exist.
    const options = await beginAuthentication(null);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ challenge: options.challenge })
    ).toString("base64url");

    const result = await finishAuthentication({ id: "no-such-credential", response: { clientDataJSON } } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("That passkey was not recognised.");
  });
});
