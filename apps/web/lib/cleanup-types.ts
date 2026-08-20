/**
 * Shapes returned by the storage cleanup API.
 *
 * Mirrors `lib/server/storage-cleanup.ts`. Kept separate from the server module
 * so the browser bundle never imports anything marked `server-only`.
 */

export type CleanupAction =
  | "deleteAttachments"
  | "deleteMessages"
  | "emptyTrash"
  | "emptySpam"
  | "deleteOrphans";

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
  buckets: MailboxBucket[];
  olderThan: string;
}

export interface Orphans {
  count: number;
  bytes: number;
  ids: string[];
}
