import "server-only";
import { db } from "./db";
import { audit } from "./auth";
import { storage } from "./storage";

/**
 * Storage cleanup.
 *
 * Everything here deletes real rows and real bytes. Three rules follow from
 * that, and they are why this file is not simply a few DELETE statements:
 *
 * 1. NOTHING IS DELETED WITHOUT BEING NAMED FIRST. Every destructive call is
 *    preceded by an inspection query the UI shows, so the confirmation names
 *    actual messages and actual sizes rather than a count the user must trust.
 *
 * 2. OWNERSHIP IS IN THE WHERE CLAUSE, NOT IN A CHECK BEFOREHAND. A separate
 *    "does this belong to you" query invites a race and a forgotten call site;
 *    `user_id = ?` on the statement itself cannot be forgotten.
 *
 * 3. A PARTIAL FAILURE IS REPORTED AS A PARTIAL FAILURE. Blob deletion can
 *    fail per file — a network filesystem can be unreachable for one object
 *    and fine for the next. The database row is only removed once its bytes
 *    are gone, so a failure leaves a still-listed attachment rather than an
 *    invisible orphan consuming quota forever.
 */

export interface LargeAttachment {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  messageId: string | null;
  subject: string | null;
  receivedAt: string | null;
}

export interface LargeMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  /** Message bytes plus everything attached to it. */
  totalBytes: number;
  attachmentCount: number;
}

export interface MailboxBucket {
  role: string;
  name: string;
  messages: number;
  bytes: number;
}

export interface CleanupReport {
  largestAttachments: LargeAttachment[];
  largestMessages: LargeMessage[];
  oldMessages: LargeMessage[];
  /** Per-mailbox totals, so Trash and Spam can be emptied knowingly. */
  buckets: MailboxBucket[];
  /** Cut-off used for `oldMessages`, echoed back so the UI states it exactly. */
  olderThan: string;
}

const LIST_LIMIT = 20;

/** Bytes a message accounts for: its own row plus its attachments. */
const MESSAGE_TOTAL_BYTES = `
  (COALESCE(m.size_bytes, 0) +
   COALESCE((SELECT SUM(a.size_bytes) FROM attachments a WHERE a.message_id = m.id), 0))`;

function toLargeMessage(row: Record<string, unknown>): LargeMessage {
  return {
    id: row.id as string,
    subject: ((row.subject as string) ?? "").trim() || "(no subject)",
    from: (row.from_email as string) ?? "",
    receivedAt: row.received_at as string,
    totalBytes: Number(row.total_bytes ?? 0),
    attachmentCount: Number(row.attachment_count ?? 0),
  };
}

/**
 * What is taking up space, and what is old enough to be worth removing.
 *
 * Read-only. Nothing here changes anything, so the UI can call it freely to
 * refresh totals after a deletion.
 */
export function cleanupReport(userId: string, olderThanDays = 365): CleanupReport {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  const largestAttachments = (
    db()
      .prepare(
        `SELECT a.id, a.filename, a.size_bytes, a.content_type, a.message_id,
                m.subject, m.received_at
           FROM attachments a
           LEFT JOIN messages m ON m.id = a.message_id AND m.user_id = a.user_id
          WHERE a.user_id = ?
          ORDER BY a.size_bytes DESC
          LIMIT ?`
      )
      .all(userId, LIST_LIMIT) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    filename: (row.filename as string) ?? "(unnamed)",
    size: Number(row.size_bytes ?? 0),
    contentType: (row.content_type as string) ?? "application/octet-stream",
    messageId: (row.message_id as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    receivedAt: (row.received_at as string | null) ?? null,
  }));

  const largestMessages = (
    db()
      .prepare(
        `SELECT m.id, m.subject, m.from_email, m.received_at,
                ${MESSAGE_TOTAL_BYTES} AS total_bytes,
                (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count
           FROM messages m
          WHERE m.user_id = ? AND m.deleted_at IS NULL
          ORDER BY total_bytes DESC
          LIMIT ?`
      )
      .all(userId, LIST_LIMIT) as Record<string, unknown>[]
  ).map(toLargeMessage);

  const oldMessages = (
    db()
      .prepare(
        `SELECT m.id, m.subject, m.from_email, m.received_at,
                ${MESSAGE_TOTAL_BYTES} AS total_bytes,
                (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count
           FROM messages m
          WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.received_at < ?
          ORDER BY total_bytes DESC
          LIMIT ?`
      )
      .all(userId, cutoff, LIST_LIMIT) as Record<string, unknown>[]
  ).map(toLargeMessage);

  const buckets = (
    db()
      .prepare(
        `SELECT b.role, b.name,
                COUNT(m.id) AS messages,
                COALESCE(SUM(${MESSAGE_TOTAL_BYTES}), 0) AS bytes
           FROM mailboxes b
           LEFT JOIN messages m ON m.mailbox_id = b.id AND m.user_id = b.user_id
          WHERE b.user_id = ?
          GROUP BY b.id, b.role, b.name
          ORDER BY b.sort_order`
      )
      .all(userId) as Record<string, unknown>[]
  ).map((row) => ({
    role: (row.role as string) ?? "",
    name: (row.name as string) ?? "",
    messages: Number(row.messages ?? 0),
    bytes: Number(row.bytes ?? 0),
  }));

  return { largestAttachments, largestMessages, oldMessages, buckets, olderThan: cutoff };
}

export interface DeleteOutcome {
  /** Rows actually removed. Never the number requested. */
  deleted: number;
  /** Bytes genuinely reclaimed, counted from what was deleted. */
  freedBytes: number;
  /** One entry per item that could not be removed, with the reason. */
  failures: { id: string; reason: string }[];
}

/**
 * Delete attachments by id.
 *
 * Blob first, row second. The other order would remove the record of a file
 * whose bytes are still on disk — an orphan nothing can find, still counted
 * against nobody's quota. Losing a row for a blob that is already gone is
 * recoverable; the reverse is not.
 */
export async function deleteAttachments(userId: string, ids: string[]): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: 0, freedBytes: 0, failures: [] };
  if (ids.length === 0) return outcome;

  for (const id of ids) {
    // Ownership in the WHERE clause: another account's id selects nothing.
    const row = db()
      .prepare(`SELECT id, size_bytes, storage_key FROM attachments WHERE id = ? AND user_id = ?`)
      .get(id, userId) as { id: string; size_bytes: number; storage_key: string } | undefined;

    if (!row) {
      outcome.failures.push({ id, reason: "Not found." });
      continue;
    }

    // Never destroy bytes another row still points at. Uploads currently get
    // their own key, so this cannot happen today — but the guard is what keeps
    // it true if content-addressed dedup is ever added, and discovering that
    // by losing one message's attachment when another is deleted would be an
    // expensive way to learn it.
    const sharing = db()
      .prepare(`SELECT COUNT(*) AS n FROM attachments WHERE storage_key = ? AND id <> ?`)
      .get(row.storage_key, id) as { n: number };

    if (Number(sharing.n) > 0) {
      // The record goes; the blob stays, because something else needs it.
      const detached = db()
        .prepare(`DELETE FROM attachments WHERE id = ? AND user_id = ?`)
        .run(id, userId);
      if (Number(detached.changes) > 0) {
        outcome.deleted += 1;
        // No bytes were reclaimed: the file is still there for the other row.
      }
      continue;
    }

    try {
      await storage().delete(row.storage_key);
    } catch (cause) {
      // The row stays. An attachment that still lists is a visible problem;
      // a deleted row over a live blob is an invisible one.
      outcome.failures.push({
        id,
        reason: cause instanceof Error ? cause.message : "The stored file could not be removed.",
      });
      continue;
    }

    const result = db()
      .prepare(`DELETE FROM attachments WHERE id = ? AND user_id = ?`)
      .run(id, userId);

    if (Number(result.changes) > 0) {
      outcome.deleted += 1;
      outcome.freedBytes += Number(row.size_bytes ?? 0);
    } else {
      outcome.failures.push({ id, reason: "The record could not be removed." });
    }
  }

  return outcome;
}

/**
 * Permanently delete messages, and everything attached to them.
 *
 * This is not "move to trash" — there is no undo, which is why the caller has
 * to have shown the user exactly what is going.
 */
export async function deleteMessages(userId: string, ids: string[]): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: 0, freedBytes: 0, failures: [] };
  if (ids.length === 0) return outcome;

  for (const id of ids) {
    const message = db()
      .prepare(`SELECT id, size_bytes FROM messages WHERE id = ? AND user_id = ?`)
      .get(id, userId) as { id: string; size_bytes: number } | undefined;

    if (!message) {
      outcome.failures.push({ id, reason: "Not found." });
      continue;
    }

    const attachments = db()
      .prepare(`SELECT id FROM attachments WHERE message_id = ? AND user_id = ?`)
      .all(id, userId) as { id: string }[];

    const blobs = await deleteAttachments(
      userId,
      attachments.map((a) => a.id)
    );
    outcome.freedBytes += blobs.freedBytes;

    if (blobs.failures.length > 0) {
      // Deleting the message would strand those blobs beyond reach, because
      // nothing would list them any more.
      outcome.failures.push({
        id,
        reason: `${blobs.failures.length} attachment(s) could not be removed, so the message was kept.`,
      });
      continue;
    }

    const result = db().prepare(`DELETE FROM messages WHERE id = ? AND user_id = ?`).run(id, userId);
    if (Number(result.changes) > 0) {
      outcome.deleted += 1;
      outcome.freedBytes += Number(message.size_bytes ?? 0);
    } else {
      outcome.failures.push({ id, reason: "The message could not be removed." });
    }
  }

  return outcome;
}

/**
 * Empty a whole mailbox, permanently.
 *
 * Only Trash and Spam. Emptying Inbox or Sent from a settings page is not a
 * cleanup tool, it is an accident waiting to be reported as a bug.
 */
export async function emptyMailbox(
  userId: string,
  role: "trash" | "junk"
): Promise<DeleteOutcome & { role: string }> {
  const mailbox = db()
    .prepare(`SELECT id FROM mailboxes WHERE user_id = ? AND role = ?`)
    .get(userId, role) as { id: string } | undefined;

  if (!mailbox) {
    return { deleted: 0, freedBytes: 0, failures: [{ id: role, reason: "No such mailbox." }], role };
  }

  const ids = (
    db()
      .prepare(`SELECT id FROM messages WHERE user_id = ? AND mailbox_id = ?`)
      .all(userId, mailbox.id) as { id: string }[]
  ).map((row) => row.id);

  const outcome = await deleteMessages(userId, ids);
  return { ...outcome, role };
}

/**
 * Attachments belonging to no message.
 *
 * Uploads are attached to a draft on save, so a file picked and then abandoned
 * before any save leaves a row with `message_id IS NULL`. They are invisible
 * in the interface and still count against quota, which makes them the one
 * category worth deleting without naming each file.
 */
export function orphanedAttachments(userId: string): { count: number; bytes: number; ids: string[] } {
  const rows = db()
    .prepare(
      `SELECT id, size_bytes FROM attachments
        WHERE user_id = ? AND message_id IS NULL AND created_at < ?`
    )
    // An hour's grace: a file uploading right now has no message yet either.
    .all(userId, new Date(Date.now() - 60 * 60 * 1000).toISOString()) as {
    id: string;
    size_bytes: number;
  }[];

  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
    ids: rows.map((row) => row.id),
  };
}

/**
 * Recorded so a permanent deletion is never silent.
 *
 * Reuses the existing `audit()` writer rather than inserting directly — one
 * place decides the row shape, and the account center already reads it.
 */
export function recordCleanup(
  userId: string,
  action: string,
  details: Record<string, unknown>
): void {
  audit(userId, action, details, "warning");
}
