import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guard for user-supplied storage endpoints.
 *
 * A storage connector takes a URL from the user and makes the SERVER fetch it.
 * That is server-side request forgery by construction, and the mail server is
 * an unusually good position to forge from: it sits inside the network, holds
 * credentials, and its outbound requests are trusted by everything around it.
 * Without this module, "add WebDAV storage" is a port scanner for the LAN and
 * a reader of cloud metadata endpoints.
 *
 * The defence has to happen at the RESOLVED ADDRESS, not the hostname. An
 * attacker controls DNS for their own domain, so `storage.example.com` can
 * resolve to 169.254.169.254. Checking the name proves nothing; checking what
 * it resolves to is the only check that holds.
 *
 * Remaining gap, stated plainly: this resolves and then the HTTP client
 * resolves again, so a DNS entry that changes between the two calls is not
 * covered (a "DNS rebinding" attack). Closing it properly requires pinning the
 * connection to the address that was checked, which needs a custom agent per
 * request. `PRIVATE_NETWORKS` blocks the ranges that make rebinding worth
 * doing, and the residual risk is recorded in docs/security.md rather than
 * being quietly ignored.
 */

/** Ranges no storage endpoint has any business pointing at. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC 1918 private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback — the mail server itself
  ["169.254.0.0", 16], // link-local, and cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // RFC 1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC 1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function v4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function inV4Range(address: string, network: string, bits: number): boolean {
  const a = v4ToInt(address);
  const n = v4ToInt(network);
  if (a === null || n === null) return false;
  // A /0 mask would shift by 32, which is a no-op in JS rather than zero.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (n & mask);
}

/** True when this address is one the server must never be asked to reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) return BLOCKED_V4.some(([net, bits]) => inV4Range(address, net, bits));

  if (family === 6) {
    const normalised = address.toLowerCase().replace(/^\[|\]$/g, "");

    // IPv4 written as IPv6 (::ffff:127.0.0.1) reaches the same host, so it is
    // unwrapped and re-checked rather than treated as a different address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
    if (mapped) return isBlockedAddress(mapped[1]!);

    if (normalised === "::" || normalised === "::1") return true;
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
    if (/^f[cd]/.test(normalised)) return true;
    if (/^fe[89ab]/.test(normalised)) return true;
    if (/^ff/.test(normalised)) return true;
    return false;
  }

  return false;
}

export interface EndpointPolicy {
  /** Protocols the connector accepts. Everything else is refused outright. */
  allowedProtocols: string[];
  /**
   * Permit private and loopback addresses.
   *
   * Off by default. A self-hosted deployment genuinely may have its NAS on
   * 192.168.x.x, so this exists — but as a deliberate server-side setting, not
   * something a request can ask for.
   */
  allowPrivateNetworks?: boolean;
}

export type EndpointVerdict =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: string };

/**
 * Check a user-supplied endpoint before the server connects to it.
 *
 * Failure messages deliberately say what is wrong without echoing resolved
 * addresses back: "that host resolves to 10.0.0.5" is itself the answer to a
 * network-mapping question.
 */
export async function checkEndpoint(
  raw: string,
  policy: EndpointPolicy
): Promise<EndpointVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }

  if (!policy.allowedProtocols.includes(url.protocol)) {
    return {
      ok: false,
      reason: `Only ${policy.allowedProtocols.join(", ")} endpoints are accepted.`,
    };
  }

  // Credentials in the URL would end up in logs and error messages.
  if (url.username || url.password) {
    return { ok: false, reason: "Put credentials in the username and password fields, not the URL." };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);

  const addresses: string[] = [];
  if (literal) {
    addresses.push(host);
  } else {
    try {
      // Every record, not just the first: a host that returns one public and
      // one private address must not pass on the strength of the public one.
      const resolved = await lookup(host, { all: true });
      for (const entry of resolved) addresses.push(entry.address);
    } catch {
      return { ok: false, reason: "That hostname could not be resolved." };
    }
  }

  if (addresses.length === 0) {
    return { ok: false, reason: "That hostname could not be resolved." };
  }

  if (!policy.allowPrivateNetworks) {
    const blocked = addresses.some((address) => isBlockedAddress(address));
    if (blocked) {
      return {
        ok: false,
        reason:
          "That address is on a private, loopback or link-local network. " +
          "Set STORAGE_ALLOW_PRIVATE_ENDPOINTS=true on the server to connect to storage inside your own network.",
      };
    }
  }

  return { ok: true, url, addresses };
}

/**
 * Strip anything credential-shaped out of a message before it is stored,
 * logged or returned.
 *
 * Connector errors quote the request that failed, and that request carries an
 * Authorization header or a presigned query string. This is the last line
 * before such a message reaches an audit row or a UI toast.
 */
export function redact(message: string): string {
  return message
    // To end of line, not one token: `Authorization: Basic <token>` would
    // otherwise lose only the word "Basic" and keep the credential itself.
    .replace(/(Authorization|Proxy-Authorization)\s*:\s*[^\r\n]+/gi, "$1: [redacted]")
    .replace(/(Basic|Bearer|AWS4-HMAC-SHA256)\s+[A-Za-z0-9+/=_\-.:,]{8,}/g, "$1 [redacted]")
    .replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|sig|signature|token|password|secret|access_key|secret_key)=)[^&\s]+/gi, "$1[redacted]")
    // Covers key=value, key: value and JSON's "key":"value" — in the last the
    // quote sits between the name and the colon, which a naive pattern misses.
    .replace(
      /("?)\b(password|passwd|secret|secretAccessKey|secretKey|accessKeyId|accessKey|token)\b\1(\s*[:=]\s*)("?)[^\s",}]+\4/gi,
      "$1$2$1$3[redacted]"
    )
    // https://user:pass@host
    .replace(/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@");
}
