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

describe("reply and forward", () => {
  /** A received message from someone else, with this account on the Cc line. */
  function inbound(): string {
    const id = "msg-" + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    db()
      .prepare(
        `INSERT INTO mailboxes (id, user_id, role, name, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
      )
      .run("mb-inbox", USER, "inbox", "Inbox", 0, now);
    db()
      .prepare(`INSERT INTO threads (id, user_id, subject_key, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run("th-" + id, USER, "budget", now, now);
    db()
      .prepare(
        `INSERT INTO messages
           (id, user_id, thread_id, mailbox_id, from_name, from_email, subject,
            preview, body_text, body_html, message_id, references_list,
            is_draft, is_read, received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      )
      .run(
        id, USER, "th-" + id, "mb-inbox", "Dana", "dana@example.test",
        "Budget review", "text", "text", "<p>The numbers</p>",
        `<${id}@example.test>`, JSON.stringify(["<root@example.test>"]), now, now
      );
    db()
      .prepare(`INSERT INTO message_recipients (id, message_id, kind, name, email, position)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run("r1-" + id, id, "to", null, "lee@example.test", 0);
    db()
      .prepare(`INSERT INTO message_recipients (id, message_id, kind, name, email, position)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run("r2-" + id, id, "cc", null, FROM.email, 0);
    return id;
  }

  it("replies to the sender alone", () => {
    const draftId = compose.createReplyDraft(USER, FROM, inbound(), "reply")!;
    const draft = compose.loadDraft(USER, draftId)!;
    expect(draft.to).toEqual([{ name: "Dana", email: "dana@example.test" }]);
    expect(draft.cc).toEqual([]);
    expect(draft.subject).toBe("Re: Budget review");
  });

  it("reply-all keeps the other recipients but never the account itself", () => {
    const draftId = compose.createReplyDraft(USER, FROM, inbound(), "replyAll")!;
    const draft = compose.loadDraft(USER, draftId)!;
    expect(draft.to).toEqual([{ name: "Dana", email: "dana@example.test" }]);
    expect(draft.cc!.map((a) => a.email)).toEqual(["lee@example.test"]);
    // Replying to yourself is never what was meant.
    expect(draft.cc!.map((a) => a.email)).not.toContain(FROM.email);
  });

  it("carries the threading headers so the reply lands in the conversation", () => {
    const id = inbound();
    const draftId = compose.createReplyDraft(USER, FROM, id, "reply")!;
    const draft = compose.loadDraft(USER, draftId)!;
    expect(draft.inReplyTo).toBe(`<${id}@example.test>`);
    expect(draft.references).toEqual(["<root@example.test>", `<${id}@example.test>`]);
  });

  it("forwards with NO recipients, and starts a new chain", () => {
    const draftId = compose.createReplyDraft(USER, FROM, inbound(), "forward")!;
    const draft = compose.loadDraft(USER, draftId)!;
    // Pre-filling the original recipients is how a private thread gets leaked.
    expect(draft.to).toEqual([]);
    expect(draft.cc).toEqual([]);
    expect(draft.subject).toBe("Fwd: Budget review");
    expect(draft.inReplyTo).toBeNull();
    expect(draft.references).toEqual([]);
  });

  it("quotes the real stored body", () => {
    const draftId = compose.createReplyDraft(USER, FROM, inbound(), "reply")!;
    expect(compose.loadDraft(USER, draftId)!.bodyHtml).toContain("The numbers");
  });

  it("does not stack prefixes on an already-prefixed subject", () => {
    const id = inbound();
    db().prepare(`UPDATE messages SET subject = ? WHERE id = ?`).run("Re: Budget review", id);
    const draftId = compose.createReplyDraft(USER, FROM, id, "reply")!;
    expect(compose.loadDraft(USER, draftId)!.subject).toBe("Re: Budget review");
  });

  it("refuses to reply to another account's message", () => {
    expect(compose.createReplyDraft("someone-else", FROM, inbound(), "reply")).toBeNull();
  });

  it("refuses to reply to a draft", () => {
    const draft = compose.createDraft(USER, FROM);
    expect(compose.createReplyDraft(USER, FROM, draft, "reply")).toBeNull();
  });
});

describe("thread list", () => {
  let mail: typeof import("./mail");

  beforeAll(async () => {
    mail = await import("./mail");
  });

  it("returns one row per thread, even with several messages in it", () => {
    const now = new Date().toISOString();
    db()
      .prepare(
        `INSERT INTO mailboxes (id, user_id, role, name, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
      )
      .run("mb-list", USER, "archive", "Archive", 5, now);
    db()
      .prepare(`INSERT INTO threads (id, user_id, subject_key, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run("th-shared", USER, "shared", now, now);

    // Three messages, one conversation, one mailbox.
    const seeds: [string, string][] = [
      ["a", "2026-01-01T00:00:00Z"],
      ["b", "2026-01-02T00:00:00Z"],
      ["c", "2026-01-03T00:00:00Z"],
    ];
    for (const [n, at] of seeds) {
      db()
        .prepare(
          `INSERT INTO messages
             (id, user_id, thread_id, mailbox_id, from_name, from_email, subject,
              preview, body_text, body_html, is_draft, is_read, received_at, created_at)
           VALUES (?, ?, 'th-shared', 'mb-list', NULL, ?, ?, '', '', '', 0, 1, ?, ?)`
        )
        .run("m-" + n, USER, "x@example.test", "Message " + n, at, at);
    }

    const page = mail.queryThreads(USER, { mailboxId: "mb-list", limit: 50, cursor: null });
    const ids = page.items.map((t) => t.id);

    // Duplicated ids are not merely a React key warning: selection is keyed on
    // the id, so one tick would select every row sharing it.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "th-shared")).toHaveLength(1);

    // The row represents the NEWEST message in the thread.
    const row = page.items.find((t) => t.id === "th-shared")!;
    expect(row.latest.subject).toBe("Message c");
    expect(row.messageCount).toBe(3);

    // `total` counts threads, matching the rows. A message count here would
    // report a total the list can never reach.
    expect(page.total).toBe(1);
  });
});
