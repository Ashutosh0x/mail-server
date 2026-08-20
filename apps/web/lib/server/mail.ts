import "server-only";
import type { EmailHeader, Label, Mailbox, Thread } from "@mailserver/types";
import { parseQuery, termsOf, durationToMs, sizeToBytes } from "@mailserver/types";
import { db, newId, nowIso, transaction } from "./db";

/** What node:sqlite accepts as a bound parameter. */
type SqlValue = string | number | bigint | null | Uint8Array;

/**
 * Mailbox reads and mutations.
 *
 * EVERY function takes `userId` and every query filters on it. Not because the
 * caller is untrusted, but because one forgotten predicate in a mail store is
 * one user reading another's inbox — so the parameter is mandatory and there is
 * no overload that omits it.
 */

const SYSTEM_MAILBOXES: { role: string; name: string; sort: number }[] = [
  { role: "inbox", name: "Inbox", sort: 0 },
  { role: "sent", name: "Sent", sort: 1 },
  { role: "drafts", name: "Drafts", sort: 2 },
  { role: "archive", name: "Archive", sort: 3 },
  { role: "junk", name: "Spam", sort: 4 },
  { role: "trash", name: "Trash", sort: 5 },
];

/**
 * Create the six system mailboxes for a new account.
 *
 * This is structure, not content: an empty Inbox is a fact about the account,
 * whereas a message in it would be fabricated. No sample mail is ever created.
 */
export function provisionMailboxes(userId: string): void {
  const insert = db().prepare(
    `INSERT OR IGNORE INTO mailboxes (id, user_id, name, role, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const box of SYSTEM_MAILBOXES) {
    insert.run(newId(), userId, box.name, box.role, box.sort, nowIso());
  }
}

/** Mailboxes with live counts. Counts are computed, never stored and drifted. */
export function listMailboxes(userId: string): Mailbox[] {
  const rows = db()
    .prepare(
      `SELECT m.id, m.name, m.parent_id, m.role, m.sort_order,
              COUNT(msg.id)                                        AS total_emails,
              COALESCE(SUM(CASE WHEN msg.is_read = 0 THEN 1 END), 0) AS unread_emails,
              COUNT(DISTINCT msg.thread_id)                        AS total_threads,
              COUNT(DISTINCT CASE WHEN msg.is_read = 0 THEN msg.thread_id END) AS unread_threads
         FROM mailboxes m
         LEFT JOIN messages msg
           ON msg.mailbox_id = m.id AND msg.deleted_at IS NULL
        WHERE m.user_id = ?
        GROUP BY m.id
        ORDER BY m.sort_order, m.name`
    )
    .all(userId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    parentId: (row.parent_id as string | null) ?? null,
    role: (row.role as Mailbox["role"]) ?? null,
    sortOrder: Number(row.sort_order),
    totalEmails: Number(row.total_emails),
    unreadEmails: Number(row.unread_emails),
    totalThreads: Number(row.total_threads),
    unreadThreads: Number(row.unread_threads),
  }));
}

export function listLabels(userId: string): Label[] {
  const rows = db()
    .prepare(`SELECT id, name, color FROM labels WHERE user_id = ? AND is_hidden = 0 ORDER BY name`)
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    color: row.color as Label["color"],
  }));
}

export function createLabel(userId: string, name: string, color: Label["color"]): Label {
  const id = newId();
  db()
    .prepare(`INSERT INTO labels (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, userId, name, color, nowIso());
  return { id, name, color };
}

// ── Query building ─────────────────────────────────────────────────────────

interface QueryOptions {
  mailboxId?: string;
  labelId?: string;
  search?: string;
  limit: number;
  cursor?: string | null;
}

/**
 * Translate the shared search grammar into SQL.
 *
 * The grammar is parsed by the same module the UI's filter chips use, so a chip
 * saying `has:attachment` and the rows returned cannot disagree. Values are
 * always bound parameters — nothing from a search box is ever concatenated into
 * the statement.
 */
function buildWhere(userId: string, options: QueryOptions): { sql: string; params: SqlValue[] } {
  const clauses = ["m.user_id = ?", "m.deleted_at IS NULL"];
  const params: SqlValue[] = [userId];

  if (options.mailboxId) {
    clauses.push("m.mailbox_id = ?");
    params.push(options.mailboxId);
  }
  if (options.labelId) {
    clauses.push("EXISTS (SELECT 1 FROM message_labels ml WHERE ml.message_id = m.id AND ml.label_id = ?)");
    params.push(options.labelId);
  }

  const parsed = parseQuery(options.search ?? "");
  for (const term of termsOf(parsed)) {
    const negate = (sql: string) => (term.negated ? `NOT (${sql})` : sql);
    const like = `%${term.value}%`;

    switch (term.field) {
      case "from":
        clauses.push(negate("(m.from_email LIKE ? OR m.from_name LIKE ?)"));
        params.push(like, like);
        break;
      case "to":
      case "cc":
      case "bcc": {
        clauses.push(
          negate(
            `EXISTS (SELECT 1 FROM message_recipients r
                      WHERE r.message_id = m.id AND r.kind = ? AND (r.email LIKE ? OR r.name LIKE ?))`
          )
        );
        params.push(term.field, like, like);
        break;
      }
      case "subject":
        clauses.push(negate("m.subject LIKE ?"));
        params.push(like);
        break;
      case "filename":
        clauses.push(
          negate(`EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.filename LIKE ?)`)
        );
        params.push(like);
        break;
      case "label":
        clauses.push(
          negate(
            `EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                      WHERE ml.message_id = m.id AND l.user_id = m.user_id AND l.name = ?)`
          )
        );
        params.push(term.value);
        break;
      case "in":
        clauses.push(
          negate(`EXISTS (SELECT 1 FROM mailboxes mb WHERE mb.id = m.mailbox_id AND mb.role = ?)`)
        );
        params.push(term.value.toLowerCase());
        break;
      case "has":
        if (term.value.toLowerCase() === "attachment") clauses.push(negate("m.has_attachment = 1"));
        break;
      case "is": {
        const flag: Record<string, string> = {
          unread: "m.is_read = 0",
          read: "m.is_read = 1",
          starred: "m.is_flagged = 1",
          flagged: "m.is_flagged = 1",
          draft: "m.is_draft = 1",
          snoozed: "m.snoozed_until IS NOT NULL",
        };
        const sql = flag[term.value.toLowerCase()];
        if (sql) clauses.push(negate(sql));
        break;
      }
      case "after":
        clauses.push(negate("m.received_at >= ?"));
        params.push(`${term.value}T00:00:00.000Z`);
        break;
      case "before":
        clauses.push(negate("m.received_at < ?"));
        params.push(`${term.value}T00:00:00.000Z`);
        break;
      case "newer": {
        const ms = durationToMs(term.value);
        if (ms !== null) {
          clauses.push(negate("m.received_at >= ?"));
          params.push(new Date(Date.now() - ms).toISOString());
        }
        break;
      }
      case "older": {
        const ms = durationToMs(term.value);
        if (ms !== null) {
          clauses.push(negate("m.received_at < ?"));
          params.push(new Date(Date.now() - ms).toISOString());
        }
        break;
      }
      case "larger": {
        const bytes = sizeToBytes(term.value);
        if (bytes !== null) {
          clauses.push(negate("m.size_bytes > ?"));
          params.push(bytes);
        }
        break;
      }
      case "smaller": {
        const bytes = sizeToBytes(term.value);
        if (bytes !== null) {
          clauses.push(negate("m.size_bytes < ?"));
          params.push(bytes);
        }
        break;
      }
      default:
        break;
    }
  }

  // Free text goes through FTS5 rather than a LIKE over every body — the whole
  // point of the index. Anything the parser did not claim as an operator lands
  // here.
  const freeText = parsed.groups
    .flat()
    .filter((node) => node.kind === "text")
    .map((node) => node.value)
    .join(" ")
    .trim();
  if (freeText) {
    clauses.push(`m.id IN (SELECT rowid_ref FROM (
        SELECT f.rowid AS rowid_ref FROM messages_fts f WHERE messages_fts MATCH ?
      ))`);
    // Quote the whole thing so operators inside user text cannot become FTS
    // syntax — `AND`, `NEAR(` and `"` are all query language to FTS5.
    params.push(`"${freeText.replace(/"/g, '""')}"`);
  }

  return { sql: clauses.join(" AND "), params };
}

export interface ThreadPage {
  items: Thread[];
  nextCursor: string | null;
  total: number;
}

/**
 * Keeps only the newest message of each thread *within the same mailbox*.
 *
 * Scoped to `mailbox_id` deliberately. A thread whose newest message sits in
 * Sent must still appear in Inbox, represented by its newest message there —
 * an unscoped check would make it vanish from every mailbox but one.
 *
 * `NOT EXISTS` rather than `GROUP BY ... MAX()`: SQLite would allow the bare
 * columns, PostgreSQL would reject them, and this file has to run on both.
 */
const NEWEST_IN_THREAD = `NOT EXISTS (
  SELECT 1 FROM messages newer
   WHERE newer.thread_id = m.thread_id
     AND newer.mailbox_id = m.mailbox_id
     AND newer.user_id = m.user_id
     AND newer.deleted_at IS NULL
     AND (newer.received_at > m.received_at
          OR (newer.received_at = m.received_at AND newer.id > m.id))
)`;

/**
 * Threads for a mailbox, newest first.
 *
 * Keyset pagination on `(received_at, id)`, not OFFSET: an OFFSET of 50,000
 * makes SQLite walk 50,000 rows, and it silently skips or repeats rows when
 * mail arrives mid-scroll. The cursor is a position, so neither happens.
 *
 * ONE ROW PER THREAD. The rows come from `messages`, and each is presented as
 * its thread, so without `NEWEST_IN_THREAD` two messages of one conversation
 * in the same mailbox produce two rows carrying the SAME id. That is not just
 * a duplicate React key: selection is keyed on the id, so ticking one row
 * would tick both, and a bulk archive would act on more than was chosen.
 *
 * It went unnoticed while every draft got a fresh thread of its own. Replying
 * puts the draft in the conversation it answers, which made it reachable.
 */
export function queryThreads(userId: string, options: QueryOptions): ThreadPage {
  const { sql, params } = buildWhere(userId, options);
  const limit = Math.max(1, Math.min(options.limit, 100));

  const cursorClause = options.cursor ? " AND (m.received_at, m.id) < (?, ?)" : "";
  const cursorParams = options.cursor ? decodeCursor(options.cursor) : [];

  const rows = db()
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM messages t WHERE t.thread_id = m.thread_id AND t.deleted_at IS NULL) AS msg_count,
              (SELECT COUNT(*) FROM messages t WHERE t.thread_id = m.thread_id AND t.is_read = 0 AND t.deleted_at IS NULL) AS unread_count
         FROM messages m
        WHERE ${sql}${cursorClause} AND ${NEWEST_IN_THREAD}
        ORDER BY m.received_at DESC, m.id DESC
        LIMIT ?`
    )
    .all(...params, ...cursorParams, limit + 1) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Counts threads, matching the rows. Counting messages here would report a
  // total the list can never reach.
  const total = Number(
    (
      db()
        .prepare(`SELECT COUNT(*) AS n FROM messages m WHERE ${sql} AND ${NEWEST_IN_THREAD}`)
        .get(...params) as { n: number }
    ).n
  );

  const last = page[page.length - 1];
  return {
    items: page.map((row) => toThread(row)),
    nextCursor: hasMore && last ? encodeCursor(last.received_at as string, last.id as string) : null,
    total,
  };
}

function encodeCursor(receivedAt: string, id: string): string {
  return Buffer.from(`${receivedAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  const [receivedAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return [receivedAt ?? "", id ?? ""];
}

function recipientsOf(messageId: string, kind: string) {
  const rows = db()
    .prepare(`SELECT name, email FROM message_recipients WHERE message_id = ? AND kind = ? ORDER BY position`)
    .all(messageId, kind) as Record<string, unknown>[];
  return rows.map((r) => ({ name: (r.name as string | null) ?? null, email: r.email as string }));
}

function attachmentsOf(messageId: string) {
  const rows = db()
    .prepare(
      `SELECT id, filename, content_type, size_bytes, is_inline, content_id
         FROM attachments WHERE message_id = ?`
    )
    .all(messageId) as Record<string, unknown>[];
  return rows.map((r) => ({
    blobId: r.id as string,
    partId: null,
    name: (r.filename as string | null) ?? null,
    type: r.content_type as string,
    size: Number(r.size_bytes),
    isInline: Number(r.is_inline) === 1,
    cid: (r.content_id as string | null) ?? null,
  }));
}

/**
 * The single place authentication results become a verdict.
 *
 * Derived on the SERVER so the web client, a future mobile client and the API
 * cannot each decide "is this phishing" differently for the same message.
 */
function verdictOf(row: Record<string, unknown>): EmailHeader["verdict"] {
  const spf = row.spf_result as string;
  const dkim = row.dkim_result as string;
  const dmarc = row.dmarc_result as string;
  const spoof = Number(row.display_name_spoof) === 1 || Number(row.idn_homograph) === 1;

  if (dmarc === "fail" || spoof) return "dangerous";
  if (spf === "fail" || dkim === "fail") return "suspicious";
  if (spf === "pass" && dkim === "pass" && dmarc === "pass") return "verified";
  return "unverified";
}

export function toEmailHeader(row: Record<string, unknown>): EmailHeader {
  const id = row.id as string;
  const keywords: string[] = [];
  if (Number(row.is_read) === 1) keywords.push("$seen");
  if (Number(row.is_flagged) === 1) keywords.push("$flagged");
  if (Number(row.is_draft) === 1) keywords.push("$draft");
  if (Number(row.is_answered) === 1) keywords.push("$answered");

  return {
    id,
    blobId: id,
    threadId: row.thread_id as string,
    mailboxIds: [row.mailbox_id as string],
    keywords,
    from: [{ name: (row.from_name as string | null) ?? null, email: row.from_email as string }],
    to: recipientsOf(id, "to"),
    cc: recipientsOf(id, "cc"),
    bcc: recipientsOf(id, "bcc"),
    replyTo: recipientsOf(id, "reply-to"),
    subject: row.subject as string,
    preview: row.preview as string,
    receivedAt: row.received_at as string,
    sentAt: (row.sent_at as string | null) ?? null,
    size: Number(row.size_bytes),
    hasAttachment: Number(row.has_attachment) === 1,
    attachments: Number(row.has_attachment) === 1 ? attachmentsOf(id) : [],
    authentication: {
      spf: row.spf_result as never,
      dkim: row.dkim_result as never,
      dmarc: row.dmarc_result as never,
      arc: (row.arc_result as never) ?? null,
      tls: (row.tls_version as string | null) ?? null,
      displayNameSpoof: Number(row.display_name_spoof) === 1,
      idnHomograph: Number(row.idn_homograph) === 1,
    },
    verdict: verdictOf(row),
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
  };
}

function toThread(row: Record<string, unknown>): Thread {
  const latest = toEmailHeader(row);
  return {
    id: latest.threadId,
    emailIds: [latest.id],
    latest,
    messageCount: Number(row.msg_count ?? 1),
    unreadCount: Number(row.unread_count ?? 0),
    hasAttachment: latest.hasAttachment,
    participants: [...latest.from, ...latest.to],
  };
}

/** Every message in a thread, oldest first. Scoped to the owner. */
export function getThread(userId: string, threadId: string): { thread: Thread; emails: EmailHeader[] } | null {
  const rows = db()
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM messages t WHERE t.thread_id = m.thread_id AND t.deleted_at IS NULL) AS msg_count,
              (SELECT COUNT(*) FROM messages t WHERE t.thread_id = m.thread_id AND t.is_read = 0 AND t.deleted_at IS NULL) AS unread_count
         FROM messages m
        WHERE m.user_id = ? AND m.thread_id = ? AND m.deleted_at IS NULL
        ORDER BY m.received_at ASC`
    )
    .all(userId, threadId) as Record<string, unknown>[];

  if (rows.length === 0) return null;
  const emails = rows.map(toEmailHeader);
  const newest = rows[rows.length - 1]!;
  return { thread: toThread(newest), emails };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export type MessageAction = "read" | "unread" | "star" | "unstar" | "archive" | "trash" | "restore" | "spam" | "delete";

/**
 * Apply an action to messages the caller owns.
 *
 * Returns the number of rows actually changed. The caller reports that back, so
 * a UI that optimistically archived five messages can reconcile when only four
 * were the user's.
 */
export function applyAction(userId: string, messageIds: string[], action: MessageAction): number {
  if (messageIds.length === 0) return 0;
  const holes = messageIds.map(() => "?").join(",");

  return transaction(() => {
    const roleId = (role: string): string | null => {
      const row = db()
        .prepare(`SELECT id FROM mailboxes WHERE user_id = ? AND role = ?`)
        .get(userId, role) as { id: string } | undefined;
      return row?.id ?? null;
    };

    const move = (role: string) => {
      const target = roleId(role);
      if (!target) return 0;
      const result = db()
        .prepare(`UPDATE messages SET mailbox_id = ? WHERE user_id = ? AND id IN (${holes})`)
        .run(target, userId, ...messageIds);
      return Number(result.changes);
    };

    switch (action) {
      case "read":
      case "unread": {
        const result = db()
          .prepare(`UPDATE messages SET is_read = ? WHERE user_id = ? AND id IN (${holes})`)
          .run(action === "read" ? 1 : 0, userId, ...messageIds);
        return Number(result.changes);
      }
      case "star":
      case "unstar": {
        const result = db()
          .prepare(`UPDATE messages SET is_flagged = ? WHERE user_id = ? AND id IN (${holes})`)
          .run(action === "star" ? 1 : 0, userId, ...messageIds);
        return Number(result.changes);
      }
      case "archive":
        return move("archive");
      case "spam":
        return move("junk");
      case "restore":
        return move("inbox");
      case "trash":
        return move("trash");
      case "delete": {
        // Soft delete. Permanent removal is a separate, explicit endpoint —
        // an "empty trash" click should not be reachable from a list action.
        const result = db()
          .prepare(`UPDATE messages SET deleted_at = ? WHERE user_id = ? AND id IN (${holes})`)
          .run(nowIso(), userId, ...messageIds);
        return Number(result.changes);
      }
    }
  });
}
