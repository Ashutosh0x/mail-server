import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The SSRF guard.
 *
 * These tests exist because the failure they prevent is silent: a connector
 * that happily fetches 169.254.169.254 looks exactly like one that works,
 * right up until someone uses it to read cloud credentials.
 */

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const { checkEndpoint, isBlockedAddress, redact } = await import("./endpoint-guard");

beforeEach(() => {
  lookupMock.mockReset();
});

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1", "loopback — the mail server itself"],
    ["10.1.2.3", "RFC 1918"],
    ["172.16.0.1", "RFC 1918"],
    ["172.31.255.254", "RFC 1918 upper bound"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.169.254", "cloud metadata"],
    ["0.0.0.0", "this network"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["224.0.0.1", "multicast"],
  ])("blocks %s (%s)", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([["8.8.8.8"], ["1.1.1.1"], ["93.184.216.34"], ["172.32.0.1"], ["11.0.0.1"]])(
    "allows the public address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );

  it("blocks IPv6 loopback, unique-local and link-local", () => {
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fd00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("ff02::1")).toBe(true);
  });

  it("unwraps IPv4-mapped IPv6, which reaches the same host", () => {
    // ::ffff:127.0.0.1 is loopback wearing a different notation.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows a public IPv6 address", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("checkEndpoint", () => {
  const policy = { allowedProtocols: ["https:"] };

  it("refuses a protocol outside the allow-list", async () => {
    const verdict = await checkEndpoint("file:///etc/passwd", policy);
    expect(verdict.ok).toBe(false);
  });

  it("refuses plain HTTP when only HTTPS is allowed", async () => {
    expect((await checkEndpoint("http://example.com/dav", policy)).ok).toBe(false);
  });

  it("refuses credentials embedded in the URL", async () => {
    // They would end up in logs and error messages.
    const verdict = await checkEndpoint("https://user:secret@example.com/dav", policy);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/credentials/i);
  });

  it("checks the RESOLVED address, not the hostname", async () => {
    // The attacker owns the domain, so the name proves nothing.
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const verdict = await checkEndpoint("https://totally-normal.example.com/", policy);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/private, loopback or link-local/i);
  });

  it("refuses when ANY resolved address is private", async () => {
    // One public answer must not launder a private one.
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect((await checkEndpoint("https://mixed.example.com/", policy)).ok).toBe(false);
  });

  it("accepts a public host and reports what it resolved to", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const verdict = await checkEndpoint("https://example.com/dav", policy);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.addresses).toEqual(["93.184.216.34"]);
  });

  it("refuses a private IP literal without resolving anything", async () => {
    const verdict = await checkEndpoint("https://192.168.1.10/dav", policy);
    expect(verdict.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows a private address only when the server opts in", async () => {
    // A self-hosted NAS on 192.168.x.x is a legitimate target, but it takes a
    // server-side setting — never something the request can ask for.
    const verdict = await checkEndpoint("https://192.168.1.10/dav", {
      allowedProtocols: ["https:"],
      allowPrivateNetworks: true,
    });
    expect(verdict.ok).toBe(true);
  });

  it("fails closed when the name does not resolve", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect((await checkEndpoint("https://nope.example.com/", policy)).ok).toBe(false);
  });
});

describe("redact", () => {
  it("removes an Authorization header", () => {
    expect(redact("failed: Authorization: Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
  });

  it("removes an S3 signature from a query string", () => {
    const message = redact("GET /b/k?X-Amz-Signature=deadbeefcafe&X-Amz-Date=1 failed");
    expect(message).not.toContain("deadbeefcafe");
    expect(message).toContain("[redacted]");
  });

  it("removes credentials from a URL", () => {
    expect(redact("connect https://admin:hunter2@nas.local/dav")).not.toContain("hunter2");
  });

  it("removes a labelled secret", () => {
    expect(redact('{"secretAccessKey":"AKIAnotreal12345"}')).not.toContain("AKIAnotreal12345");
    expect(redact("password=hunter2")).not.toContain("hunter2");
  });

  it("leaves an ordinary message intact", () => {
    const message = "The server refused the connection (ECONNREFUSED).";
    expect(redact(message)).toBe(message);
  });
});
