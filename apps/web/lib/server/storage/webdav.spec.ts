import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { WebDavConnector } from "./webdav";

/**
 * The WebDAV connector, against a REAL WebDAV server.
 *
 * A mocked `fetch` would only prove the connector sends what the test told it
 * to send. These run against an actual HTTP server that parses the requests,
 * writes real files to disk, and answers with real multistatus XML — so a
 * malformed PROPFIND body or a mis-parsed href fails here rather than in front
 * of someone's NAS.
 *
 * The server is started by the suite itself and listens on loopback, which is
 * why these tests set STORAGE_ALLOW_PRIVATE_ENDPOINTS and WEBDAV_ALLOW_INSECURE.
 * Both default to off in production, and there is a test below asserting that
 * loopback is refused without them.
 */

const PORT = 4919;
const BASE = `http://127.0.0.1:${PORT}`;
const CREDENTIALS = { username: "davuser", password: "davpass" };

let server: import("node:http").Server;
let root: string;

beforeAll(async () => {
  const { createServer } = await import("node:http");
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { tmpdir } = await import("node:os");

  root = fs.mkdtempSync(join(tmpdir(), "dav-spec-"));
  fs.mkdirSync(join(root, "existing-folder"), { recursive: true });
  fs.writeFileSync(join(root, "hello.txt"), "hello from webdav\n");

  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const diskPath = (urlPath: string): string | null => {
    const full = join(root, decodeURIComponent(urlPath).replace(/^\/+/, ""));
    return full.startsWith(root) ? full : null;
  };

  const entry = (urlPath: string, disk: string): string => {
    const stat = fs.statSync(disk);
    const isDir = stat.isDirectory();
    return (
      `<d:response><d:href>${escape(urlPath)}${isDir && !urlPath.endsWith("/") ? "/" : ""}</d:href>` +
      `<d:propstat><d:prop>` +
      `<d:displayname>${escape(urlPath.split("/").filter(Boolean).pop() ?? "")}</d:displayname>` +
      (isDir
        ? "<d:resourcetype><d:collection/></d:resourcetype>"
        : `<d:resourcetype/><d:getcontentlength>${stat.size}</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype>`) +
      `<d:getlastmodified>${stat.mtime.toUTCString()}</d:getlastmodified>` +
      `<d:quota-available-bytes>1073741824</d:quota-available-bytes>` +
      `<d:quota-used-bytes>4096</d:quota-used-bytes>` +
      `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    );
  };

  server = createServer((req, res) => {
    const expected = "Basic " + Buffer.from("davuser:davpass").toString("base64");
    if ((req.headers.authorization ?? "") !== expected) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="dav"' });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", BASE);
    const disk = diskPath(url.pathname);
    if (disk === null) {
      res.writeHead(403);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      switch (req.method) {
        case "PROPFIND": {
          if (!fs.existsSync(disk)) return void res.writeHead(404).end();
          const parts = [entry(url.pathname, disk)];
          if ((req.headers.depth ?? "1") === "1" && fs.statSync(disk).isDirectory()) {
            for (const name of fs.readdirSync(disk)) {
              parts.push(
                entry(url.pathname.replace(/\/+$/, "") + "/" + encodeURIComponent(name), join(disk, name))
              );
            }
          }
          res.writeHead(207, { "Content-Type": "application/xml" });
          res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${parts.join("")}</d:multistatus>`);
          return;
        }
        case "GET": {
          if (!fs.existsSync(disk) || fs.statSync(disk).isDirectory()) return void res.writeHead(404).end();
          res.writeHead(200);
          res.end(fs.readFileSync(disk));
          return;
        }
        case "PUT":
          fs.mkdirSync(dirname(disk), { recursive: true });
          fs.writeFileSync(disk, body);
          return void res.writeHead(201).end();
        case "MKCOL":
          if (fs.existsSync(disk)) return void res.writeHead(405).end();
          fs.mkdirSync(disk, { recursive: true });
          return void res.writeHead(201).end();
        case "DELETE":
          if (!fs.existsSync(disk)) return void res.writeHead(404).end();
          fs.rmSync(disk, { recursive: true, force: true });
          return void res.writeHead(204).end();
        case "MOVE":
        case "COPY": {
          const destination = diskPath(new URL(String(req.headers.destination)).pathname);
          if (destination === null) return void res.writeHead(403).end();
          if (!fs.existsSync(disk)) return void res.writeHead(404).end();
          fs.mkdirSync(dirname(destination), { recursive: true });
          if (req.method === "MOVE") fs.renameSync(disk, destination);
          else fs.copyFileSync(disk, destination);
          return void res.writeHead(201).end();
        }
        default:
          res.writeHead(405).end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  process.env.STORAGE_ALLOW_PRIVATE_ENDPOINTS = "true";
  process.env.WEBDAV_ALLOW_INSECURE = "true";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const fs = await import("node:fs");
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.STORAGE_ALLOW_PRIVATE_ENDPOINTS;
  delete process.env.WEBDAV_ALLOW_INSECURE;
});

const connector = () => new WebDavConnector({ url: BASE, ...CREDENTIALS });

describe("WebDAV connection test", () => {
  it("reports connected only after the server actually answers", async () => {
    const result = await connector().testConnection();
    expect(result.state).toBe("connected");
    expect(result.latencyMs).not.toBeNull();
  });

  it("reads RFC 4331 quota when the server publishes it", async () => {
    const { capacity } = await connector().testConnection();
    expect(capacity.freeBytes).toBe(1073741824);
    expect(capacity.usedBytes).toBe(4096);
    expect(capacity.totalBytes).toBe(1073741824 + 4096);
  });

  it("reports authentication_required for a bad password, not a generic error", async () => {
    const wrong = new WebDavConnector({ url: BASE, username: "davuser", password: "wrong" });
    const result = await wrong.testConnection();
    expect(result.state).toBe("authentication_required");
  });

  it("reports unreachable when nothing is listening", async () => {
    const dead = new WebDavConnector({ url: "http://127.0.0.1:4931", ...CREDENTIALS });
    const result = await dead.testConnection();
    expect(result.state).toBe("unreachable");
    // Never "connected" on a failure, and no invented capacity.
    expect(result.capacity.totalBytes).toBeNull();
  });
});

describe("WebDAV file operations", () => {
  it("lists a directory without including the directory itself", async () => {
    const entries = await connector().list("");
    const names = entries.map((e) => e.name);
    expect(names).toContain("hello.txt");
    expect(names).toContain("existing-folder");
    // The collection describes itself in its own multistatus; that entry must
    // not appear as a child, or every folder contains itself.
    expect(names).not.toContain("");
  });

  it("distinguishes files from collections and reads real sizes", async () => {
    const entries = await connector().list("");
    const file = entries.find((e) => e.name === "hello.txt")!;
    const folder = entries.find((e) => e.name === "existing-folder")!;
    expect(file.isDirectory).toBe(false);
    expect(file.size).toBe("hello from webdav\n".length);
    expect(folder.isDirectory).toBe(true);
  });

  it("uploads and downloads the same bytes", async () => {
    const dav = connector();
    const payload = "round trip äöü 🎉";
    await dav.upload("round-trip.txt", payload);

    const stream = await dav.download("round-trip.txt");
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe(payload);
  });

  it("creates a folder, moves a file into it, then deletes it", async () => {
    const dav = connector();
    await dav.mkdir("new-folder");
    await dav.upload("to-move.txt", "move me");
    await dav.move("to-move.txt", "new-folder/moved.txt");

    const inside = await dav.list("new-folder");
    expect(inside.map((e) => e.name)).toContain("moved.txt");
    // And it is gone from where it was.
    expect((await dav.list("")).map((e) => e.name)).not.toContain("to-move.txt");

    await dav.delete("new-folder/moved.txt");
    expect((await dav.list("new-folder")).map((e) => e.name)).not.toContain("moved.txt");
  });

  it("copies without removing the original", async () => {
    const dav = connector();
    await dav.upload("original.txt", "copy me");
    await dav.copy("original.txt", "duplicate.txt");
    const names = (await dav.list("")).map((e) => e.name);
    expect(names).toContain("original.txt");
    expect(names).toContain("duplicate.txt");
  });
});

describe("WebDAV path safety", () => {
  it("clamps .. at the configured root instead of climbing out of it", async () => {
    // With the root at "/", ".." cannot escape: the segments are normalised
    // and a pop on an empty stack is a no-op, so "/../../etc" becomes "/etc",
    // which is a legitimate path INSIDE this share. The request is therefore
    // made, and the server answers 404 — it never reaches outside the root.
    await expect(connector().list("../../../etc")).rejects.toThrow(/does not exist/i);
  });

  it("refuses to escape when a subdirectory is the root", async () => {
    // This is where traversal is actually meaningful: the root is below "/",
    // so ".." would reach a sibling the connection was never granted.
    const scoped = new WebDavConnector({ url: BASE, ...CREDENTIALS, basePath: "existing-folder" });
    await expect(scoped.list("..")).rejects.toThrow(/outside the configured storage root/i);
  });

  it("refuses an escaping destination on move and copy", async () => {
    const scoped = new WebDavConnector({ url: BASE, ...CREDENTIALS, basePath: "existing-folder" });
    await expect(scoped.move("a.txt", "../escaped.txt")).rejects.toThrow(/outside/i);
    await expect(scoped.copy("a.txt", "../escaped.txt")).rejects.toThrow(/outside/i);
  });

  it("keeps a scoped connector inside its subdirectory", async () => {
    const dav = connector();
    await dav.upload("existing-folder/scoped.txt", "inside");

    const scoped = new WebDavConnector({ url: BASE, ...CREDENTIALS, basePath: "existing-folder" });
    const names = (await scoped.list("")).map((e) => e.name);
    expect(names).toContain("scoped.txt");
    // hello.txt is a sibling of the subdirectory, so it must not be visible.
    expect(names).not.toContain("hello.txt");
  });
});

describe("WebDAV transport policy", () => {
  it("refuses loopback when the server has not opted in", async () => {
    delete process.env.STORAGE_ALLOW_PRIVATE_ENDPOINTS;
    try {
      const result = await connector().testConnection();
      // The guard rejects before any request is made.
      expect(result.state).toBe("unreachable");
      expect(result.detail).toMatch(/private, loopback or link-local/i);
    } finally {
      process.env.STORAGE_ALLOW_PRIVATE_ENDPOINTS = "true";
    }
  });

  it("refuses plain HTTP unless explicitly enabled", async () => {
    delete process.env.WEBDAV_ALLOW_INSECURE;
    try {
      const result = await connector().testConnection();
      // Basic auth over HTTP is the password in cleartext on every request.
      expect(result.state).toBe("unreachable");
      expect(result.detail).toMatch(/https/i);
    } finally {
      process.env.WEBDAV_ALLOW_INSECURE = "true";
    }
  });
});
