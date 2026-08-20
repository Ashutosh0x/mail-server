import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Draft round-trip, against a real SQLite database.
 *
 * These are not mocked. `loadDraft` has to return exactly what the composer
 * needs to put a half-written message back on screen — recipients, subject,
 * body, version, and enough attachment metadata to render a row. A mock of
 * `db()` would assert that the mock returns what the mock was told to return;
 * the real schema is what can actually disagree with the code.
 */

// `databaseFile` is joined onto cwd, so it has to be relative. The directory
// is created under cwd rather than the system temp for that reason.
mkdirSync(join(process.cwd(), ".test-tmp"), { recursive: true });
const dir = mkdtempSync(join(process.cwd(), ".test-tmp", "compose-"));
const dbFile = relative(process.cwd(), join(dir, "test.db"));

vi.mock("./config", async () => {
  const actual = await vi.importActual<typeof import("./config")>("./config");
  return { config: { ...actual.config, databaseFile: dbFile } };
});

let compose: typeof import("./compose");
let db: typeof import("./db").db;

const USER = "user-1";
const FROM = { name: "Test User", email: "test@example.test" };

beforeAll(async () => {
  compose = await import("./compose");
  ({ db } = await import("./db"));

  // The minimum a draft needs to exist: a tenant, a domain, an account and a
  // Drafts mailbox. Foreign keys are on, so none of these can be skipped.
  const now = new Date().toISOString();
  db()
    .prepare(`INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("t-1", "Test", "test", now, now);
  db()
    .prepare(
      `INSERT INTO domains (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run("d-1", "t-1", "example.test", now, now);
  db()
    .prepare(
      `INSERT INTO users (id, tenant_id, domain_id, email, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(USER, "t-1", "d-1", FROM.email, FROM.name, "x", now, now);
  db()
    .prepare(
      `INSERT INTO mailboxes (id, user_id, role, name, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("mb-drafts", USER, "drafts", "Drafts", 2, now);
});

afterAll(() => {
  globalThis.__mailserverDb?.close();
  globalThis.__mailserverDb = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("draft round-trip", () => {
  it("returns everything the composer needs to reopen a draft", () => {
    const id = compose.createDraft(USER, FROM);

    const saved = compose.saveDraft(USER, id, {
      to: [{ name: "A", email: "a@example.test" }],
      cc: [{ name: null, email: "c@example.test" }],
      bcc: [{ name: null, email: "b@example.test" }],
      subject: "Half written",
      bodyHtml: "<p>Unfinished sentence</p>",
    });
    expect(saved.ok).toBe(true);

    const draft = compose.loadDraft(USER, id);
    expect(draft).not.toBeNull();
    expect(draft!.to).toEqual([{ name: "A", email: "a@example.test" }]);
    expect(draft!.cc).toEqual([{ name: null, email: "c@example.test" }]);
    // Bcc survives a reopen. It is withheld from the sent message's headers,
    // not from the person who wrote it.
    expect(draft!.bcc).toEqual([{ name: null, email: "b@example.test" }]);
    expect(draft!.subject).toBe("Half written");
    expect(draft!.bodyHtml).toContain("Unfinished sentence");
    expect(draft!.attachments).toEqual([]);
  });

  it("carries attachment name, size and type, not just ids", () => {
    const id = compose.createDraft(USER, FROM);
    const now = new Date().toISOString();
    db()
      .prepare(
        `INSERT INTO attachments
           (id, user_id, message_id, filename, content_type, size_bytes, storage_key, checksum, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("att-1", USER, id, "report.pdf", "application/pdf", 4096, "k/att-1", "sha256:test", now);

    const draft = compose.loadDraft(USER, id)!;
    // Ids alone would leave the composer showing a row it cannot label.
    expect(draft.attachments).toEqual([
      { id: "att-1", filename: "report.pdf", size: 4096, contentType: "application/pdf" },
    ]);
    expect(draft.attachmentIds).toEqual(["att-1"]);
  });

  it("refuses to load another account's draft", () => {
    const id = compose.createDraft(USER, FROM);
    expect(compose.loadDraft("someone-else", id)).toBeNull();
  });

  it("rejects a save carrying a stale version", () => {
    const id = compose.createDraft(USER, FROM);
    const first = compose.saveDraft(USER, id, { to: [], subject: "v1", bodyHtml: "" }, 0);
    expect(first.ok).toBe(true);

    // A second tab saving from the version it last read must not win.
    const stale = compose.saveDraft(USER, id, { to: [], subject: "v2", bodyHtml: "" }, 0);
    expect(stale.ok).toBe(false);
    expect(compose.loadDraft(USER, id)!.subject).toBe("v1");
  });
});
