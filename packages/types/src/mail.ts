/**
 * The mail domain, shaped by JMAP (RFC 8620/8621) rather than by our database.
 *
 * That direction matters. Stalwart speaks JMAP natively, so a UI modelled on
 * JMAP objects can talk to it directly; a UI modelled on our own tables would
 * need a translation layer at every call site, and the two would drift.
 *
 * Ids are opaque strings everywhere. JMAP does not promise they are UUIDs, and
 * the moment a client parses one it has invented a constraint the server never
 * agreed to.
 */

/** JMAP `Id`. Opaque — never parse, compare or order these. */
export type Id = string;

/** RFC 3339 instant, always UTC. */
export type UtcDateTime = string;

// ── Addresses ──────────────────────────────────────────────────────────────

export interface EmailAddress {
  /** Display name, if the sender supplied one. */
  name: string | null;
  /** Addr-spec, e.g. `alex@example.com`. */
  email: string;
}

// ── Mailboxes ──────────────────────────────────────────────────────────────

/**
 * JMAP mailbox roles (RFC 8621 §2). `null` for user-created folders.
 *
 * The UI keys system folders off `role`, never off `name`: a server may present
 * the inbox as "Posteingang", and matching on the display name would silently
 * fail for every non-English deployment.
 */
export type MailboxRole =
  | "inbox"
  | "archive"
  | "drafts"
  | "sent"
  | "trash"
  | "junk"
  | "important"
  | "subscribed"
  | null;

export interface Mailbox {
  id: Id;
  name: string;
  parentId: Id | null;
  role: MailboxRole;
  sortOrder: number;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
}

// ── Keywords ───────────────────────────────────────────────────────────────

/**
 * IMAP/JMAP keywords. The `$`-prefixed ones are the RFC-registered set; a
 * deployment may add its own, so this is a union with `string` rather than a
 * closed enum — rejecting an unknown keyword would drop data the server sent.
 */
export type Keyword = "$seen" | "$flagged" | "$draft" | "$answered" | "$forwarded" | (string & {});

// ── Attachments ────────────────────────────────────────────────────────────

export interface Attachment {
  /** JMAP blobId — the handle used to download the part. */
  blobId: Id;
  partId: string | null;
  name: string | null;
  type: string;
  size: number;
  /** True for images referenced by `cid:` from the HTML body. */
  isInline: boolean;
  cid: string | null;
}

// ── Authentication results ─────────────────────────────────────────────────

/**
 * Per-mechanism outcome from the receiving MTA's `Authentication-Results`.
 *
 * `none` and `fail` are deliberately distinct: "the domain published no policy"
 * and "the domain published a policy and this message violated it" are opposite
 * signals, and collapsing them into one warning is how a UI teaches users to
 * ignore the warning.
 */
export type AuthResult = "pass" | "fail" | "softfail" | "neutral" | "none" | "temperror" | "permerror";

export interface AuthenticationSummary {
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
  /** Present only when the message traversed a forwarder that sealed it. */
  arc: AuthResult | null;
  /** TLS version of the final inbound hop, e.g. "TLSv1.3". Null = plaintext. */
  tls: string | null;
  /** Set when the display name resembles a known contact but the domain differs. */
  displayNameSpoof: boolean;
  /** Set when a label contains mixed scripts that render as another domain. */
  idnHomograph: boolean;
}

/**
 * The single verdict the UI renders as a banner.
 *
 * Derived on the server from the whole `AuthenticationSummary`, not recomputed
 * per client — three clients deriving "is this phishing" three ways is three
 * chances to disagree about the same message.
 */
export type SecurityVerdict = "verified" | "unverified" | "suspicious" | "dangerous";

// ── Email ──────────────────────────────────────────────────────────────────

/**
 * Header-and-preview view of a message: everything the list needs, and nothing
 * that requires fetching a body. `EmailBody` is a separate request.
 */
export interface EmailHeader {
  id: Id;
  blobId: Id;
  threadId: Id;
  mailboxIds: Id[];
  keywords: Keyword[];
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  subject: string;
  /** Server-generated snippet. Plain text, already truncated. */
  preview: string;
  receivedAt: UtcDateTime;
  sentAt: UtcDateTime | null;
  size: number;
  hasAttachment: boolean;
  attachments: Attachment[];
  authentication: AuthenticationSummary;
  verdict: SecurityVerdict;
  /** Set while the message is snoozed; null otherwise. */
  snoozedUntil: UtcDateTime | null;
}

export interface EmailBody {
  id: Id;
  /** Sanitised HTML. Never render this outside a sandboxed frame — see the
   *  renderer in apps/web for the pipeline that produces it. */
  htmlBody: string | null;
  textBody: string | null;
  /** Remote images found and withheld, so the UI can offer to load them. */
  blockedRemoteImages: number;
  /** 1x1 beacons and known tracker hosts that were stripped outright. */
  strippedTrackers: number;
}

export interface Thread {
  id: Id;
  emailIds: Id[];
  /** Denormalised for the list: the newest message's facts. */
  latest: EmailHeader;
  messageCount: number;
  unreadCount: number;
  hasAttachment: boolean;
  /** Every distinct participant across the thread, oldest first. */
  participants: EmailAddress[];
}

// ── Labels ─────────────────────────────────────────────────────────────────

/** The twelve label colours from the design system. */
export type LabelColor =
  | "red" | "orange" | "yellow" | "green" | "teal" | "blue"
  | "indigo" | "purple" | "pink" | "gray" | "brown" | "cyan";

export const LABEL_COLORS: readonly LabelColor[] = [
  "red", "orange", "yellow", "green", "teal", "blue",
  "indigo", "purple", "pink", "gray", "brown", "cyan",
] as const;

export interface Label {
  id: Id;
  name: string;
  color: LabelColor;
}

// ── Queries ────────────────────────────────────────────────────────────────

export interface MailQuery {
  mailboxId?: Id;
  labelId?: Id;
  /** Raw search string, including operators (`from:`, `has:attachment`, …). */
  search?: string;
  isUnread?: boolean;
  isFlagged?: boolean;
  hasAttachment?: boolean;
  limit: number;
  /** Opaque cursor from the previous page. */
  cursor?: string | null;
}

export interface Page<T> {
  items: T[];
  /** Null when this is the last page. */
  nextCursor: string | null;
  /** Server-reported total, when it is cheap to compute. Null otherwise —
   *  never a client-side guess. */
  total: number | null;
}
