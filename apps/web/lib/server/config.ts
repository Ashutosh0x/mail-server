import "server-only";

/**
 * Every configurable limit, read from the environment exactly once.
 *
 * Nothing in this file has a value baked into the frontend. The browser learns
 * the limits from `GET /api/config`, and the server enforces them again on
 * every request — a client-side limit is a hint, never a control.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return Math.floor(value);
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const config = {
  /**
   * Largest single attachment. Default 100 MB rather than a token 5 MB — the
   * binding constraint in real deployments is what the RECEIVING server
   * accepts (Gmail 25 MB, many MTAs 10–50 MB), not what we can store. Sending
   * to an external recipient is checked separately against
   * `maxOutboundMessageBytes`; storing a 100 MB file for internal delivery or
   * for a share link is fine.
   */
  maxAttachmentBytes: int("MAX_ATTACHMENT_SIZE_BYTES", 100 * MB),

  /** Largest total message including all parts, after MIME encoding overhead. */
  maxMessageBytes: int("MAX_TOTAL_MESSAGE_SIZE_BYTES", 150 * MB),

  /**
   * Largest message we will hand to SMTP for an EXTERNAL recipient. Base64
   * inflates a payload by ~37%, so this is deliberately below the common
   * 25 MB receiver cap: 18 MB of attachments is about 25 MB on the wire.
   */
  maxOutboundMessageBytes: int("MAX_OUTBOUND_MESSAGE_SIZE_BYTES", 18 * MB),

  /** Per-user storage quota. */
  maxUserStorageBytes: int("MAX_USER_STORAGE_BYTES", 15 * GB),

  /** Chunk size for resumable uploads. Large files are never buffered whole. */
  uploadChunkBytes: int("UPLOAD_CHUNK_SIZE_BYTES", 8 * MB),

  /** Max recipients on one message — the anti-spam ceiling, not a UI limit. */
  maxRecipients: int("MAX_RECIPIENTS_PER_MESSAGE", 100),

  /** Page size ceiling for list endpoints. */
  maxPageSize: int("MAX_PAGE_SIZE", 100),
  defaultPageSize: int("DEFAULT_PAGE_SIZE", 50),

  /** Session lifetime. */
  sessionTtlSeconds: int("SESSION_TTL_SECONDS", 60 * 60 * 24 * 30),

  /** Where SQLite lives in development. */
  databaseFile: process.env.DATABASE_FILE ?? ".data/mailserver.db",

  /** Where attachment bytes live. Object storage in production. */
  storageDriver: (process.env.OBJECT_STORAGE_DRIVER ?? "filesystem") as "filesystem" | "s3",
  storageRoot: process.env.OBJECT_STORAGE_ROOT ?? ".data/blobs",

  /** Set to enable outbound SMTP. Absent means sending fails loudly. */
  smtp: {
    host: process.env.SMTP_HOST ?? null,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    user: process.env.SMTP_USER ?? null,
    from: process.env.SMTP_FROM ?? null,
  },

  isProduction: process.env.NODE_ENV === "production",
} as const;

/** The subset the browser is allowed to know. No secrets, no hostnames. */
export function publicConfig() {
  return {
    maxAttachmentBytes: config.maxAttachmentBytes,
    maxMessageBytes: config.maxMessageBytes,
    maxOutboundMessageBytes: config.maxOutboundMessageBytes,
    maxUserStorageBytes: config.maxUserStorageBytes,
    uploadChunkBytes: config.uploadChunkBytes,
    maxRecipients: config.maxRecipients,
    maxPageSize: config.maxPageSize,
    defaultPageSize: config.defaultPageSize,
    /** So the composer can disable Send with a reason instead of failing late. */
    outboundConfigured: config.smtp.host !== null,
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
