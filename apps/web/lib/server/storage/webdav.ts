import "server-only";
import { Readable } from "node:stream";
import { checkEndpoint, redact } from "./endpoint-guard";
import type {
  ConnectionProbe,
  ConnectorCapabilities,
  StorageConnector,
  StorageEntry,
  StorageUsageReport,
} from "./connector";
import { safeRelativePath } from "./connector";

/**
 * WebDAV connector.
 *
 * WebDAV is HTTP, so this needs no client library: PROPFIND, MKCOL, PUT, GET,
 * DELETE, MOVE and COPY over `fetch`. Adding a dependency to send HTTP verbs
 * would be weight for nothing.
 *
 * What this file is careful about:
 *
 *   - EVERY REQUEST GOES THROUGH THE ENDPOINT GUARD. The URL comes from the
 *     user, so without that check this class is a LAN scanner with the mail
 *     server's network position.
 *
 *   - HTTPS UNLESS THE SERVER SAYS OTHERWISE. WebDAV authenticates with Basic,
 *     which is a base64 of the password on every single request. Over plain
 *     HTTP that is the password in cleartext, repeatedly.
 *
 *   - ERRORS ARE REDACTED BEFORE THEY LEAVE. A failed request quotes the
 *     request, and the request carries the Authorization header.
 *
 *   - BODIES STREAM. `download` hands back the response body rather than
 *     buffering it, so a 4 GB file does not become 4 GB of process memory.
 */

export interface WebDavConfig {
  /** Base URL of the collection, e.g. https://dav.example.com/remote.php/dav */
  url: string;
  username: string;
  password: string;
  /** Optional subdirectory beneath the base URL. */
  basePath?: string;
}

/** Entries and probe results use the shared connector contract. */
export type WebDavEntry = StorageEntry;

const TIMEOUT_MS = 20_000;

function allowInsecure(): boolean {
  return process.env.WEBDAV_ALLOW_INSECURE === "true";
}

function allowPrivate(): boolean {
  return process.env.STORAGE_ALLOW_PRIVATE_ENDPOINTS === "true";
}

/** Text between a namespaced tag, tolerating any prefix the server chose. */
function tagText(xml: string, local: string): string | null {
  const match = new RegExp(`<[^>:]*:?${local}[^>]*>([\\s\\S]*?)</[^>:]*:?${local}>`, "i").exec(xml);
  return match ? match[1]!.trim() : null;
}

export class WebDavConnector implements StorageConnector {
  readonly kind = "webdav";

  capabilities(): ConnectorCapabilities {
    // WebDAV defines all of these; whether the SERVER permits them is
    // discovered per request, and surfaces as an error from that request.
    return { read: true, write: true, move: true, copy: true, mkdir: true, usage: true };
  }

  constructor(private readonly config: WebDavConfig) {}

  private authHeader(): string {
    return (
      "Basic " + Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")
    );
  }

  /**
   * Resolve a path against the configured base, refusing to escape it.
   *
   * `../` in a user-supplied path would otherwise reach collections outside
   * the configured root — the WebDAV equivalent of directory traversal.
   */
  private resolve(path: string): string | null {
    const base = new URL(this.config.url);
    const basePath = (base.pathname.replace(/\/+$/, "") + "/" + (this.config.basePath ?? "").replace(/^\/+/, ""))
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");

    const joined = (basePath + "/" + path.replace(/^\/+/, "")).replace(/\/+/g, "/");

    // Normalise ".." segments and check the result is still inside the root.
    const segments: string[] = [];
    for (const segment of joined.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    const normalised = "/" + segments.join("/");

    const root = basePath === "" ? "/" : basePath;
    if (normalised !== root && !normalised.startsWith(root === "/" ? "/" : root + "/")) {
      return null;
    }
    return normalised;
  }

  private async request(
    method: string,
    path: string,
    init: { body?: BodyInit | Readable; headers?: Record<string, string> } = {}
  ): Promise<Response> {
    const resolved = this.resolve(path);
    if (resolved === null) {
      throw new Error("That path is outside the configured storage root.");
    }

    const target = new URL(this.config.url);
    target.pathname = resolved;

    const verdict = await checkEndpoint(target.toString(), {
      allowedProtocols: allowInsecure() ? ["https:", "http:"] : ["https:"],
      allowPrivateNetworks: allowPrivate(),
    });
    if (!verdict.ok) throw new Error(verdict.reason);

    // Every request is bounded. A storage server that accepts a connection and
    // then never answers would otherwise hold the handler open indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // A Node stream is converted rather than buffered, so an upload of any
      // size stays a stream all the way to the socket.
      const body =
        init.body instanceof Readable
          ? (Readable.toWeb(init.body) as unknown as BodyInit)
          : init.body;

      return await fetch(target.toString(), {
        method,
        headers: { Authorization: this.authHeader(), ...(init.headers ?? {}) },
        body,
        // Required by undici whenever the body is a stream.
        ...(init.body instanceof Readable ? { duplex: "half" } : {}),
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The request failed.";
      throw new Error(redact(message));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Probe the server for real. Never reports "connected" without a response. */
  async testConnection(): Promise<ConnectionProbe> {
    const started = Date.now();
    let response: Response;

    try {
      response = await this.request("PROPFIND", "", {
        headers: { Depth: "0", "Content-Type": "application/xml" },
        body:
          '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>' +
          "<d:quota-available-bytes/><d:quota-used-bytes/></d:prop></d:propfind>",
      });
    } catch (cause) {
      return {
        state: "unreachable",
        detail: redact(cause instanceof Error ? cause.message : "The server could not be reached."),
        usage: { totalBytes: null, usedBytes: null, freeBytes: null },
        latencyMs: null,
        writable: null,
      };
    }

    const latencyMs = Date.now() - started;

    if (response.status === 401 || response.status === 403) {
      return {
        state: response.status === 401 ? "authentication_required" : "permission_denied",
        detail:
          response.status === 401
            ? "The server rejected those credentials."
            : "Those credentials are valid but lack access to that path.",
        usage: { totalBytes: null, usedBytes: null, freeBytes: null },
        latencyMs,
        writable: null,
      };
    }

    if (!response.ok && response.status !== 207) {
      return {
        state: "error",
        detail: `The server answered ${response.status}.`,
        usage: { totalBytes: null, usedBytes: null, freeBytes: null },
        latencyMs,
        writable: null,
      };
    }

    const xml = await response.text();

    // RFC 4331. Many servers do not implement it, and the honest answer then
    // is "unavailable" — never a computed or assumed figure.
    const availableRaw = tagText(xml, "quota-available-bytes");
    const usedRaw = tagText(xml, "quota-used-bytes");
    const free = availableRaw !== null && /^\d+$/.test(availableRaw) ? Number(availableRaw) : null;
    const used = usedRaw !== null && /^\d+$/.test(usedRaw) ? Number(usedRaw) : null;

    return {
      state: "connected",
      detail: "Connected.",
      usage: {
        freeBytes: free,
        usedBytes: used,
        totalBytes: free !== null && used !== null ? free + used : null,
      },
      latencyMs,
      // Not probed here: finding out means writing a file, which a connection
      // test should not do. `list` and `upload` report their own failures.
      writable: null,
    };
  }

  /** One directory level. Depth 1, because Depth infinity can be enormous. */
  async list(path = ""): Promise<WebDavEntry[]> {
    const response = await this.request("PROPFIND", path, {
      headers: { Depth: "1", "Content-Type": "application/xml" },
      body:
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>' +
        "<d:displayname/><d:getcontentlength/><d:getlastmodified/>" +
        "<d:getcontenttype/><d:resourcetype/></d:prop></d:propfind>",
    });

    if (response.status === 401) throw new Error("The server rejected those credentials.");
    if (response.status === 404) throw new Error("That folder does not exist.");
    if (response.status !== 207) throw new Error(`The server answered ${response.status}.`);

    const xml = await response.text();
    const self = this.resolve(path);
    const rootPath = (this.resolve("") ?? "/").replace(/\/+$/, "") || "/";
    const entries: WebDavEntry[] = [];

    for (const block of xml.split(/<[^>:]*:?response[\s>]/i).slice(1)) {
      const href = tagText(block, "href");
      if (!href) continue;

      const decoded = decodeURIComponent(href).replace(/\/+$/, "");
      // The collection describes itself in its own listing; skip that entry.
      if (self && decoded === self.replace(/\/+$/, "")) continue;

      const isDirectory = /<[^>:]*:?collection\s*\/?>/i.test(block);
      const lengthRaw = tagText(block, "getcontentlength");
      const modified = tagText(block, "getlastmodified");

      // Relative to the connection root: the browser navigates by these, and
      // handing it absolute server paths would leak the URL layout and break
      // the moment the base path changed.
      const relative = rootPath === "/" ? decoded.replace(/^\//, "") : decoded.slice(rootPath.length + 1);

      entries.push({
        name: decoded.split("/").filter(Boolean).pop() ?? "",
        path: relative,
        isDirectory,
        size: lengthRaw && /^\d+$/.test(lengthRaw) ? Number(lengthRaw) : null,
        modifiedAt: modified ? new Date(modified).toISOString() : null,
        contentType: tagText(block, "getcontenttype"),
      });
    }
    return entries;
  }

  async mkdir(path: string): Promise<void> {
    const response = await this.request("MKCOL", path);
    if (response.status === 405) return; // Already there.
    if (!response.ok) throw new Error(`Could not create that folder (${response.status}).`);
  }

  /** Streams the body straight through; nothing is buffered here. */
  async upload(path: string, body: BodyInit | Readable): Promise<void> {
    const response = await this.request("PUT", path, { body });
    if (response.status === 507) throw new Error("The storage server is out of space.");
    if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  }

  /** Returns a Node stream, so a large file never lands in memory. */
  async download(path: string): Promise<Readable> {
    const response = await this.request("GET", path);
    if (response.status === 404) throw new Error("That file does not exist.");
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  /** One entry, or null. Used by the browser to resolve a path before acting. */
  async stat(path: string): Promise<StorageEntry | null> {
    const relative = safeRelativePath(path);
    if (relative === null) throw new Error("That path is not allowed.");
    const parent = relative.split("/").slice(0, -1).join("/");
    const name = relative.split("/").pop() ?? "";
    try {
      const siblings = await this.list(parent);
      return siblings.find((entry) => entry.name === name) ?? null;
    } catch {
      return null;
    }
  }

  async getUsage(): Promise<StorageUsageReport> {
    return (await this.testConnection()).usage;
  }

  async delete(path: string): Promise<void> {
    const response = await this.request("DELETE", path);
    if (!response.ok && response.status !== 404) {
      throw new Error(`Delete failed (${response.status}).`);
    }
  }

  async move(from: string, to: string): Promise<void> {
    const destination = this.resolve(to);
    if (destination === null) throw new Error("That destination is outside the storage root.");
    const target = new URL(this.config.url);
    target.pathname = destination;

    const response = await this.request("MOVE", from, {
      headers: { Destination: target.toString(), Overwrite: "F" },
    });
    if (!response.ok) throw new Error(`Move failed (${response.status}).`);
  }

  async copy(from: string, to: string): Promise<void> {
    const destination = this.resolve(to);
    if (destination === null) throw new Error("That destination is outside the storage root.");
    const target = new URL(this.config.url);
    target.pathname = destination;

    const response = await this.request("COPY", from, {
      headers: { Destination: target.toString(), Overwrite: "F" },
    });
    if (!response.ok) throw new Error(`Copy failed (${response.status}).`);
  }
}
