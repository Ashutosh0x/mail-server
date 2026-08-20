import "server-only";
import { db, newId, nowIso, transaction } from "./db";
import { sanitizeMessageHtml } from "./sanitize";
import { config } from "./config";
import { storage } from "./storage";
import {
  buildMessage,
  envelopeRecipients,
  htmlToText,
  isValidAddress,
  newMessageId,
  type Address,
  type MessageInput,
} from "./mime";

/**
 * Drafts and the send pipeline.
 *
 * A draft IS a message row with `is_draft = 1` in the Drafts mailbox, not a
 * parallel store. Sending moves it rather than copying it, so an attachment
 * already uploaded against the draft needs no second copy and a draft can
 * never diverge from the message it becomes.
 *
 * The honest boundary of this file: it takes a draft all the way to a row in
 * `outbound_queue` with a fully-built RFC 5322 message. It does NOT deliver.
 * Delivery is `transport.ts`, which requires SMTP to be configured and fails
 * loudly when it is not — the queue is a real durable state, not a pretend
 * "sent".
 */

export interface DraftInput {
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  bodyHtml: string;
  /** Attachment ids already uploaded and owned by this user. */
  attachmentIds?: string[];
  inReplyTo?: string | null;
  references?: string[];
}

export interface DraftRecord extends DraftInput {
  id: string;
  updatedAt: string;
  /** Bumped on every save. A stale version loses to a newer one. */
  version: number;
}

function mailboxFor(userId: string, role: string): string {
  const row = db()
    .prepare(`SELECT id FROM mailboxes WHERE user_id = ? AND role = ?`)
    .get(userId, role) as { id: string } | undefined;
  if (!row) throw new Error(`No ${role} mailbox for this account.`);
  return row.id;
}

function readRecipients(messageId: string): {
  to: Address[];
  cc: Address[];
  bcc: Address[];
} {
  const rows = db()
    .prepare(
      `SELECT kind, name, email FROM message_recipients
        WHERE message_id = ? ORDER BY kind, position`
    )
    .all(messageId) as { kind: string; name: string | null; email: string }[];

  const pick = (kind: string) =>
    rows.filter((row) => row.kind === kind).map((row) => ({ name: row.name, email: row.email }));

  return { to: pick("to"), cc: pick("cc"), bcc: pick("bcc") };
}

function writeRecipients(messageId: string, input: DraftInput): void {
  db().prepare(`DELETE FROM message_recipients WHERE message_id = ?`).run(messageId);
  const insert = db().prepare(
    `INSERT INTO message_recipients (id, message_id, kind, name, email, position)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const [kind, list] of [
    ["to", input.to],
    ["cc", input.cc ?? []],
    ["bcc", input.bcc ?? []],
  ] as const) {
    list.forEach((address, index) => {
      insert.run(newId(), messageId, kind, address.name ?? null, address.email, index);
    });
  }
}

// ── Drafts ─────────────────────────────────────────────────────────────────

export function createDraft(userId: string, from: Address): string {
  const id = newId();
  const threadId = newId();
  const now = nowIso();

  transaction(() => {
    db()
      .prepare(
        `INSERT INTO threads (id, user_id, subject_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(threadId, userId, "", now, now);

    db()
      .prepare(
        `INSERT INTO messages
           (id, user_id, thread_id, mailbox_id, from_name, from_email, subject,
            preview, body_text, body_html, is_draft, is_read, received_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', '', '', '', 1, 1, ?, ?)`
      )
      .run(id, userId, threadId, mailboxFor(userId, "drafts"), from.name ?? null, from.email, now, now);
  });

  return id;
}

/**
 * Save a draft.
 *
 * Ownership is in the WHERE clause, so another user's draft id updates zero
 * rows. `expectedVersion` implements optimistic concurrency: two tabs editing
 * the same draft cannot silently overwrite each other, because the second save
 * arrives with a version that no longer matches.
 */
export function saveDraft(
  userId: string,
  draftId: string,
  input: DraftInput,
  expectedVersion?: number
): { ok: true; version: number } | { ok: false; reason: "not_found" | "conflict"; current?: DraftRecord } {
  const existing = db()
    .prepare(`SELECT id, version FROM messages WHERE id = ? AND user_id = ? AND is_draft = 1`)
    .get(draftId, userId) as { id: string; version: number } | undefined;

  if (!existing) return { ok: false, reason: "not_found" };

  const current = Number(existing.version ?? 0);
  if (expectedVersion !== undefined && expectedVersion !== current) {
    // Never silently overwrite newer content — hand back what is on the server
    // and let the caller decide.
    return { ok: false, reason: "conflict", current: loadDraft(userId, draftId) ?? undefined };
  }

  // Sanitised on the way IN, not on the way out: the stored value is what
  // gets sent, so it must already be safe. A client-side sanitiser protects
  // nobody, because anything can POST to this API directly.
  const safeHtml = sanitizeMessageHtml(input.bodyHtml);
  const text = htmlToText(safeHtml);
  const next = current + 1;

  transaction(() => {
    db()
      .prepare(
        `UPDATE messages
            SET subject = ?, body_html = ?, body_text = ?, preview = ?,
                in_reply_to = ?, references_list = ?, version = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`
      )
      .run(
        input.subject,
        safeHtml,
        text,
        text.slice(0, 200),
        input.inReplyTo ?? null,
        input.references?.length ? JSON.stringify(input.references) : null,
        next,
        nowIso(),
        draftId,
        userId
      );

    writeRecipients(draftId, input);

    // Attach uploads to the draft. Scoped by user_id so a stolen attachment id
    // from another account cannot be attached to this message.
    db().prepare(`UPDATE attachments SET message_id = NULL WHERE message_id = ? AND user_id = ?`)
      .run(draftId, userId);
    for (const attachmentId of input.attachmentIds ?? []) {
      db()
        .prepare(`UPDATE attachments SET message_id = ? WHERE id = ? AND user_id = ?`)
        .run(draftId, attachmentId, userId);
    }

    db()
      .prepare(`UPDATE messages SET has_attachment = ? WHERE id = ?`)
      .run((input.attachmentIds ?? []).length > 0 ? 1 : 0, draftId);
  });

  return { ok: true, version: next };
}

export function loadDraft(userId: string, draftId: string): DraftRecord | null {
  const row = db()
    .prepare(
      `SELECT id, subject, body_html, in_reply_to, references_list, version, updated_at
         FROM messages WHERE id = ? AND user_id = ? AND is_draft = 1`
    )
    .get(draftId, userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const attachments = db()
    .prepare(`SELECT id FROM attachments WHERE message_id = ? AND user_id = ?`)
    .all(draftId, userId) as { id: string }[];

  const recipients = readRecipients(draftId);

  return {
    id: row.id as string,
    ...recipients,
    subject: (row.subject as string) ?? "",
    bodyHtml: (row.body_html as string) ?? "",
    attachmentIds: attachments.map((a) => a.id),
    inReplyTo: (row.in_reply_to as string | null) ?? null,
    references: row.references_list ? (JSON.parse(row.references_list as string) as string[]) : [],
    version: Number(row.version ?? 0),
    updatedAt: row.updated_at as string,
  };
}

export function deleteDraft(userId: string, draftId: string): boolean {
  const result = db()
    .prepare(`DELETE FROM messages WHERE id = ? AND user_id = ? AND is_draft = 1`)
    .run(draftId, userId);
  return Number(result.changes) > 0;
}

// ── Sending ────────────────────────────────────────────────────────────────

export type SendFailure =
  | { code: "not_found"; message: string }
  | { code: "no_recipients"; message: string }
  | { code: "invalid_recipient"; message: string }
  | { code: "too_many_recipients"; message: string }
  | { code: "too_large"; message: string }
  | { code: "unauthorized_sender"; message: string };

export interface SendResult {
  messageId: string;
  queueId: string;
  status: string;
  /** The RFC 5322 Message-ID, server-generated. */
  rfcMessageId: string;
}

/**
 * Addresses this user is allowed to send from.
 *
 * Their own address plus any alias assigned to them. Never taken from the
 * request: a From the client can choose is a From anyone can forge, and the
 * whole point of SPF/DKIM/DMARC downstream is undone by it.
 */
export function authorizedSenders(userId: string): Address[] {
  const user = db()
    .prepare(`SELECT email, display_name FROM users WHERE id = ?`)
    .get(userId) as { email: string; display_name: string } | undefined;
  if (!user) return [];

  const aliases = db()
    .prepare(`SELECT source_address FROM aliases WHERE destination = ? AND enabled = 1`)
    .all(user.email) as { source_address: string }[];

  return [
    { name: user.display_name, email: user.email },
    ...aliases.map((alias) => ({ name: user.display_name, email: alias.source_address })),
  ];
}

/**
 * Turn a draft into a queued message.
 *
 * Everything is validated server-side, then the message is built, then the row
 * is enqueued — in one transaction, so a failure anywhere leaves the draft
 * exactly as it was rather than half-sent.
 */
export function sendDraft(
  userId: string,
  draftId: string,
  options: { idempotencyKey?: string; from?: string } = {}
): { ok: true; result: SendResult } | { ok: false; error: SendFailure } {
  // An idempotency key that has already been used returns the ORIGINAL result
  // rather than sending again. A double-clicked Send or a retried request must
  // never produce two emails.
  if (options.idempotencyKey) {
    const existing = db()
      .prepare(
        `SELECT q.id, q.message_id, q.status, m.message_id AS rfc_id
           FROM outbound_queue q JOIN messages m ON m.id = q.message_id
          WHERE q.idempotency_key = ? AND q.user_id = ?`
      )
      .get(options.idempotencyKey, userId) as Record<string, unknown> | undefined;

    if (existing) {
      return {
        ok: true,
        result: {
          messageId: existing.message_id as string,
          queueId: existing.id as string,
          status: existing.status as string,
          rfcMessageId: existing.rfc_id as string,
        },
      };
    }
  }

  const draft = loadDraft(userId, draftId);
  if (!draft) return { ok: false, error: { code: "not_found", message: "That draft no longer exists." } };

  const senders = authorizedSenders(userId);
  const from = options.from
    ? senders.find((sender) => sender.email.toLowerCase() === options.from!.toLowerCase())
    : senders[0];

  if (!from) {
    return {
      ok: false,
      error: {
        code: "unauthorized_sender",
        message: "You are not allowed to send from that address.",
      },
    };
  }

  const all = [...draft.to, ...(draft.cc ?? []), ...(draft.bcc ?? [])];
  if (all.length === 0) {
    return { ok: false, error: { code: "no_recipients", message: "Add at least one recipient." } };
  }
  if (all.length > config.maxRecipients) {
    return {
      ok: false,
      error: {
        code: "too_many_recipients",
        message: `A message can have at most ${config.maxRecipients} recipients.`,
      },
    };
  }
  for (const address of all) {
    if (!isValidAddress(address.email)) {
      return {
        ok: false,
        error: { code: "invalid_recipient", message: `"${address.email}" is not a valid email address.` },
      };
    }
  }

  const attachmentRows = db()
    .prepare(
      `SELECT id, filename, content_type, size_bytes, storage_key
         FROM attachments WHERE message_id = ? AND user_id = ?`
    )
    .all(draftId, userId) as {
    id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    storage_key: string;
  }[];

  const attachmentBytes = attachmentRows.reduce((sum, row) => sum + Number(row.size_bytes), 0);
  if (attachmentBytes > config.maxOutboundMessageBytes) {
    return {
      ok: false,
      error: {
        code: "too_large",
        message: `Attachments total ${Math.round(attachmentBytes / 1024 / 1024)} MB, over the ${Math.round(config.maxOutboundMessageBytes / 1024 / 1024)} MB limit for outgoing mail.`,
      },
    };
  }

  const domain = from.email.split("@")[1]!;
  const rfcMessageId = newMessageId(domain);
  const queueId = newId();
  const now = nowIso();

  transaction(() => {
    db()
      .prepare(
        `UPDATE messages
            SET is_draft = 0, mailbox_id = ?, message_id = ?, from_name = ?, from_email = ?,
                sent_at = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`
      )
      .run(
        mailboxFor(userId, "sent"),
        rfcMessageId,
        from.name ?? null,
        from.email,
        now,
        now,
        draftId,
        userId
      );

    db()
      .prepare(
        `INSERT INTO outbound_queue
           (id, user_id, message_id, status, attempts, next_attempt_at, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`
      )
      .run(queueId, userId, draftId, now, options.idempotencyKey ?? null, now, now);
  });

  return {
    ok: true,
    result: { messageId: draftId, queueId, status: "queued", rfcMessageId },
  };
}

/**
 * Rebuild the full RFC 5322 message for a queued row.
 *
 * Built at delivery time rather than stored: attachment bytes live in object
 * storage, and holding a second full copy of every outgoing message would
 * double storage for no benefit.
 */
export async function renderQueuedMessage(
  userId: string,
  messageRowId: string
): Promise<{ raw: string; envelope: string[]; from: string } | null> {
  const row = db()
    .prepare(
      `SELECT id, message_id, from_name, from_email, subject, body_html, body_text,
              in_reply_to, references_list
         FROM messages WHERE id = ? AND user_id = ?`
    )
    .get(messageRowId, userId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const recipients = readRecipients(messageRowId);
  const attachmentRows = db()
    .prepare(
      `SELECT filename, content_type, storage_key FROM attachments
        WHERE message_id = ? AND user_id = ?`
    )
    .all(messageRowId, userId) as { filename: string; content_type: string; storage_key: string }[];

  const attachments = [];
  for (const attachment of attachmentRows) {
    const stream = await storage().get(attachment.storage_key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    attachments.push({
      filename: attachment.filename,
      contentType: attachment.content_type,
      content: Buffer.concat(chunks),
    });
  }

  const input: MessageInput = {
    from: { name: (row.from_name as string | null) ?? null, email: row.from_email as string },
    ...recipients,
    subject: (row.subject as string) ?? "",
    text: (row.body_text as string) ?? "",
    html: (row.body_html as string) ?? null,
    attachments,
    messageId: row.message_id as string,
    inReplyTo: (row.in_reply_to as string | null) ?? null,
    references: row.references_list ? (JSON.parse(row.references_list as string) as string[]) : [],
  };

  return {
    raw: buildMessage(input),
    envelope: envelopeRecipients(input),
    from: input.from.email,
  };
}

// ── Queue status ───────────────────────────────────────────────────────────

export interface QueueEntry {
  id: string;
  messageId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function queueStatus(userId: string, queueId: string): QueueEntry | null {
  const row = db()
    .prepare(
      `SELECT id, message_id, status, attempts, last_error, created_at, updated_at
         FROM outbound_queue WHERE id = ? AND user_id = ?`
    )
    .get(queueId, userId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    status: row.status as string,
    attempts: Number(row.attempts),
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}


// ── Recent recipients ──────────────────────────────────────────────────────

export interface RecentRecipient {
  name: string | null;
  email: string;
  /** How many messages this user has sent to the address. */
  count: number;
  lastUsedAt: string;
}

/**
 * Addresses this user has actually written to.
 *
 * Derived from their own sent mail rather than from a contact store, because
 * there is no contact store — and inventing one would be exactly the fake
 * data this project refuses. Every row here is a message the user really
 * sent.
 *
 * Scoped to `user_id` throughout: one account's correspondents must never
 * surface in another's suggestions.
 */
export function recentRecipients(userId: string, query: string, limit = 8): RecentRecipient[] {
  const trimmed = query.trim().toLowerCase();

  // LIKE with a bound parameter, never string interpolation. The wildcards
  // are ours; the user text is data.
  //
  // `!` is the escape character rather than a backslash: any single
  // character works, and a backslash here would need escaping in the JS
  // string, in the SQL, and in the template literal.
  const pattern = "%" + trimmed.replace(/[%_!]/g, (c) => "!" + c) + "%";

  const rows = db()
    .prepare(
      `SELECT r.email, MAX(r.name) AS name, COUNT(*) AS n, MAX(m.created_at) AS last_used
         FROM message_recipients r
         JOIN messages m ON m.id = r.message_id
        WHERE m.user_id = ?
          AND m.is_draft = 0
          AND m.sent_at IS NOT NULL
          AND (LOWER(r.email) LIKE ? ESCAPE '!' OR LOWER(COALESCE(r.name, '')) LIKE ? ESCAPE '!')
        GROUP BY LOWER(r.email)
        ORDER BY n DESC, last_used DESC
        LIMIT ?`
    )
    .all(userId, pattern, pattern, Math.min(limit, 20)) as Record<string, unknown>[];

  return rows.map((row) => ({
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    count: Number(row.n),
    lastUsedAt: row.last_used as string,
  }));
}
