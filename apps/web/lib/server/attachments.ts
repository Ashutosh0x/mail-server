import "server-only";
import { Readable } from "node:stream";
import { db, newId, nowIso, transaction } from "./db";
import { config } from "./config";
import { newStorageKey, storage } from "./storage";
import { HEAD_BYTES, detectType, sanitizeFilename } from "./filetype";

/**
 * Attachment intake.
 *
 * The order of operations is the security property: bytes are streamed to
 * storage while being hashed and counted, the type is decided from the first
 * 4 KB rather than from anything the client said, and the size limit is
 * enforced DURING the stream so an oversized upload is aborted rather than
 * measured after it has already been written.
 */

export class UploadRejected extends Error {
  constructor(
    message: string,
    readonly code:
      | "too_large"
      | "quota_exceeded"
      | "empty"
      | "executable"
      | "storage_failed"
  ) {
    super(message);
    this.name = "UploadRejected";
  }
}

export interface AttachmentRecord {
  id: string;
  filename: string;
  contentType: string;
  declaredType: string | null;
  size: number;
  checksum: string;
  typeMismatch: boolean;
}

/** Storage currently attributed to a user, from the attachments they own. */
export function usedStorage(userId: string): number {
  const row = db()
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS used FROM attachments WHERE user_id = ?`)
    .get(userId) as { used: number };
  return Number(row.used);
}

/**
 * Stream an upload into storage.
 *
 * `web` is the browser's ReadableStream from `request.body` or a File — never
 * buffered whole. A 100 MB attachment costs a few chunks of memory, not 100 MB.
 */
export async function ingestAttachment(
  userId: string,
  web: ReadableStream<Uint8Array>,
  meta: { filename: string; declaredType: string | null }
): Promise<AttachmentRecord> {
  const filename = sanitizeFilename(meta.filename);
  const quotaRemaining = config.maxUserStorageBytes - usedStorage(userId);
  const ceiling = Math.min(config.maxAttachmentBytes, Math.max(quotaRemaining, 0));

  if (quotaRemaining <= 0) {
    throw new UploadRejected("Storage quota exceeded.", "quota_exceeded");
  }

  const head: Uint8Array[] = [];
  let headBytes = 0;
  let total = 0;

  // Enforce the ceiling mid-stream. Checking Content-Length instead would be
  // trusting a header, and checking after the write means the disk already
  // took the hit.
  const guarded = new Readable({ read() {} });
  const reader = web.getReader();

  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > ceiling) {
          const reason =
            ceiling === quotaRemaining
              ? new UploadRejected("Storage quota exceeded.", "quota_exceeded")
              : new UploadRejected(
                  `Attachment exceeds the ${config.maxAttachmentBytes} byte limit.`,
                  "too_large"
                );
          guarded.destroy(reason);
          await reader.cancel().catch(() => {});
          return;
        }
        if (headBytes < HEAD_BYTES) {
          head.push(value.subarray(0, HEAD_BYTES - headBytes));
          headBytes += Math.min(value.byteLength, HEAD_BYTES - headBytes);
        }
        guarded.push(Buffer.from(value));
      }
      guarded.push(null);
    } catch (error) {
      guarded.destroy(error as Error);
    }
  })();

  const key = newStorageKey(userId);
  let stored;
  try {
    stored = await storage().put(guarded, key);
    await pump;
  } catch (error) {
    await storage().delete(key).catch(() => {});
    if (error instanceof UploadRejected) throw error;
    throw new UploadRejected(`Upload failed: ${(error as Error).message}`, "storage_failed");
  }

  if (stored.size === 0) {
    await storage().delete(key).catch(() => {});
    throw new UploadRejected("The file is empty.", "empty");
  }

  const headBuffer = Buffer.concat(head.map((chunk) => Buffer.from(chunk)));
  const detected = detectType(headBuffer, meta.declaredType);

  const id = newId();
  db()
    .prepare(
      `INSERT INTO attachments
         (id, user_id, message_id, filename, content_type, declared_type, size_bytes,
          checksum, storage_key, is_inline, scan_status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      id,
      userId,
      filename,
      detected.mime,
      meta.declaredType,
      stored.size,
      stored.checksum,
      key,
      // No AV engine is wired. `skipped` is honest; `clean` would be a claim we
      // cannot support, and the UI shows the difference.
      "skipped",
      nowIso()
    );

  return {
    id,
    filename,
    contentType: detected.mime,
    declaredType: meta.declaredType,
    size: stored.size,
    checksum: stored.checksum,
    typeMismatch: detected.mismatch,
  };
}

/** Attachment row, only if it belongs to `userId`. */
export function getAttachment(userId: string, id: string) {
  const row = db()
    .prepare(
      `SELECT id, filename, content_type, size_bytes, storage_key, checksum, scan_status
         FROM attachments WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    filename: row.filename as string,
    contentType: row.content_type as string,
    size: Number(row.size_bytes),
    storageKey: row.storage_key as string,
    checksum: row.checksum as string,
    scanStatus: row.scan_status as string,
  };
}

/** Delete an attachment and its bytes. Ownership is part of the query. */
export async function deleteAttachment(userId: string, id: string): Promise<boolean> {
  const record = getAttachment(userId, id);
  if (!record) return false;
  transaction(() => {
    db().prepare(`DELETE FROM attachments WHERE id = ? AND user_id = ?`).run(id, userId);
  });
  // Storage after the row: an orphaned object is recoverable garbage, whereas a
  // row pointing at deleted bytes is a broken download.
  await storage().delete(record.storageKey).catch(() => {});
  return true;
}
