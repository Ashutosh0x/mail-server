import { randomUUID } from "node:crypto";

/**
 * RFC 5322 / RFC 2045 message construction.
 *
 * Deliberately hand-written rather than delegated. Unlike WebAuthn — where the
 * hard part is cryptography and a library is clearly correct — the hard part
 * here is *refusing malformed input*, and that logic has to be ours because it
 * is where header injection is stopped. A builder that quietly accepts a
 * newline in a display name will happily add a `Bcc:` the sender never wrote.
 *
 * Not marked `server-only`: it is pure string construction with no database,
 * no secrets and no request. Keeping it importable makes it exhaustively
 * testable, which for this file matters more than for most.
 *
 * Everything emitted uses CRLF. RFC 5322 requires it, and a bare LF is the
 * single most common reason a message is rejected or silently mangled by a
 * receiving MTA.
 */

export const CRLF = "\r\n";

export interface Address {
  name?: string | null;
  email: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  content: Buffer;
  /** Set for an image referenced by `cid:` from the HTML body. */
  contentId?: string;
}

export interface MessageInput {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  replyTo?: Address | null;
  subject: string;
  text: string;
  html?: string | null;
  attachments?: Attachment[];
  /** Server-generated. Never accepted from a client. */
  messageId: string;
  date?: Date;
  inReplyTo?: string | null;
  references?: string[];
}

export class MimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MimeError";
  }
}

// ── Header safety ──────────────────────────────────────────────────────────

/**
 * Characters that terminate a header line.
 *
 * CR and LF are the obvious ones. U+2028 and U+2029 are included because some
 * JSON and JavaScript paths treat them as line terminators, and NUL because it
 * truncates in any C-based MTA downstream.
 */
const HEADER_BREAKERS = /[\r\n\u2028\u2029\0]/;

export function isHeaderSafe(value: string): boolean {
  return !HEADER_BREAKERS.test(value);
}

function assertHeaderSafe(value: string, field: string): void {
  if (!isHeaderSafe(value)) {
    throw new MimeError(`${field} contains a line break, which is not allowed in a header.`);
  }
}

/**
 * Address validation.
 *
 * Deliberately stricter than RFC 5322 permits. The grammar allows quoted local
 * parts containing almost anything, including characters that make downstream
 * parsing ambiguous; nothing legitimate needs them, and accepting them widens
 * the injection surface for no benefit.
 *
 * Bounded scanning throughout — no backtracking, so a hostile address cannot
 * cost quadratic time.
 */
export function isValidAddress(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  if (!isHeaderSafe(email)) return false;

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  for (const ch of local) {
    if (!/[A-Za-z0-9!#$%&'*+/=?^_`{|}~.\-]/.test(ch)) return false;
  }

  if (domain.length > 253) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;
  // A domain with no dot is technically valid but is never what a user meant
  // when sending outside a local network.
  if (!domain.includes(".")) return false;
  for (const label of domain.split(".")) {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
  }

  return true;
}

// ── Encoding ───────────────────────────────────────────────────────────────

function needsEncoding(value: string): boolean {
  // Anything outside printable ASCII has to be encoded for a header.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return true;
  }
  return false;
}

/**
 * RFC 2047 encoded-word, for a header value containing non-ASCII.
 *
 * Base64 rather than quoted-printable: for the scripts most likely to need it
 * (CJK, Cyrillic, emoji) base64 is shorter, and correctness matters more here
 * than a few bytes.
 *
 * Chunked to keep each encoded-word under the 75-character limit RFC 2047
 * sets, splitting on whole codepoints so a multi-byte character is never cut
 * in half.
 */
export function encodeHeaderValue(value: string): string {
  if (!needsEncoding(value)) return value;

  const chunks: string[] = [];
  let current = "";

  for (const char of value) {
    const candidate = current + char;
    // 45 raw bytes encodes to 60 base64 chars, leaving room for the
    // `=?UTF-8?B?...?=` wrapper inside 75.
    if (Buffer.byteLength(candidate, "utf8") > 45) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join(`${CRLF} `);
}

/** One address, encoded and quoted as the grammar requires. */
export function formatAddress(address: Address): string {
  if (!isValidAddress(address.email)) {
    throw new MimeError(`"${address.email}" is not a valid email address.`);
  }

  const name = address.name?.trim();
  if (!name) return address.email;

  assertHeaderSafe(name, "A display name");

  if (needsEncoding(name)) return `${encodeHeaderValue(name)} <${address.email}>`;

  // A display name containing specials must be a quoted-string, with
  // backslashes and quotes escaped inside it.
  if (/[()<>@,;:\\".[\]]/.test(name)) {
    return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${address.email}>`;
  }
  return `${name} <${address.email}>`;
}

function formatAddressList(addresses: Address[]): string {
  // Folded onto continuation lines: RFC 5322 limits a line to 998 octets, and
  // a long recipient list otherwise exceeds it.
  return addresses.map(formatAddress).join(`,${CRLF} `);
}

/**
 * Quoted-printable, for a text body that is not pure ASCII.
 *
 * Preferred over base64 for text because the result stays largely readable in
 * transit, which matters when debugging a delivery failure through logs.
 */
export function quotedPrintable(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  let out = "";
  let lineLength = 0;

  const push = (piece: string) => {
    // Soft line break before exceeding the 76-character limit.
    if (lineLength + piece.length > 75) {
      out += `=${CRLF}`;
      lineLength = 0;
    }
    out += piece;
    lineLength += piece.length;
  };

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;

    if (byte === 0x0d && bytes[i + 1] === 0x0a) {
      out += CRLF;
      lineLength = 0;
      i++;
      continue;
    }
    if (byte === 0x0a) {
      out += CRLF;
      lineLength = 0;
      continue;
    }

    // Printable ASCII except `=`, which is the escape character.
    if (byte >= 33 && byte <= 126 && byte !== 61) {
      push(String.fromCharCode(byte));
      continue;
    }
    // Space and tab are literal unless they end a line, which is handled by
    // encoding trailing whitespace below.
    if ((byte === 32 || byte === 9) && bytes[i + 1] !== 0x0d && bytes[i + 1] !== 0x0a && i !== bytes.length - 1) {
      push(String.fromCharCode(byte));
      continue;
    }
    push(`=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
  }

  return out;
}

/** Base64, wrapped at 76 characters as RFC 2045 requires. */
export function base64Lines(buffer: Buffer): string {
  const encoded = buffer.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines.join(CRLF);
}

// ── Message-ID ─────────────────────────────────────────────────────────────

/**
 * A globally unique Message-ID.
 *
 * Generated by the server, always. A client-supplied value would let a sender
 * forge threading — placing a message inside someone else's conversation, or
 * colliding with an existing id to confuse a receiving client.
 */
export function newMessageId(domain: string): string {
  if (!isHeaderSafe(domain) || domain.includes("@") || domain.includes(">")) {
    throw new MimeError("Invalid domain for a Message-ID.");
  }
  return `${randomUUID()}@${domain}`;
}

// ── Plain text from HTML ───────────────────────────────────────────────────

/**
 * A readable plain-text alternative from an HTML body.
 *
 * Not a tag-strip. Structure is what makes the fallback usable: paragraphs
 * become blank lines, list items get bullets, links keep their target, and
 * quoted text keeps its marker. A recipient reading the text/plain part should
 * get the same message, not a run-on paragraph.
 */
export function htmlToText(html: string): string {
  let text = html;

  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Links keep their destination, unless the text already IS the URL.
  //
  // Held aside as placeholders rather than substituted directly: the
  // conventional plain-text form is `label <url>`, and the tag-stripper
  // below would eat those angle brackets as if they were markup.
  const links: string[] = [];
  text = text.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      const clean = label.replace(/<[^>]+>/g, "").trim();
      const rendered = !clean ? href : clean === href ? clean : `${clean} <${href}>`;
      links.push(rendered);
      // NUL cannot appear in the surrounding HTML, so the marker is
      // unambiguous and cannot be forged by the content.
      return `\u0000L${links.length - 1}\u0000`;
    }
  );

  text = text.replace(/<li\b[^>]*>/gi, "\n  • ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<blockquote\b[^>]*>/gi, "\n> ");
  text = text.replace(/<\/blockquote>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|tr|ul|ol)>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");

  // Entities, after tags so an encoded `&lt;script&gt;` cannot become a tag.
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));

  // Restore the links now that no tag-stripping remains to damage them.
  text = text.replace(/\u0000L(\d+)\u0000/g, (_m, index: string) => links[Number(index)] ?? "");

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Building ───────────────────────────────────────────────────────────────

function boundary(): string {
  return `----=_Part_${randomUUID().replace(/-/g, "")}`;
}

function header(name: string, value: string): string {
  return `${name}: ${value}${CRLF}`;
}

/**
 * Build a complete RFC 5322 message.
 *
 * Structure follows what the message actually contains, rather than always
 * emitting the most general form:
 *
 *   text only                 → text/plain
 *   text + html               → multipart/alternative
 *   text + attachments        → multipart/mixed
 *   text + html + attachments → multipart/mixed[ multipart/alternative, ... ]
 *
 * Bcc is deliberately absent from the output. It is carried separately to the
 * transport as an envelope recipient; writing it into the headers is the
 * classic way to disclose a blind copy to everyone.
 */
export function buildMessage(input: MessageInput): string {
  if (input.to.length === 0 && !input.cc?.length && !input.bcc?.length) {
    throw new MimeError("A message needs at least one recipient.");
  }

  assertHeaderSafe(input.subject, "The subject");
  assertHeaderSafe(input.messageId, "The Message-ID");

  const attachments = input.attachments ?? [];
  const hasHtml = Boolean(input.html && input.html.trim());
  const date = input.date ?? new Date();

  let headers = "";
  headers += header("MIME-Version", "1.0");
  headers += header("Date", date.toUTCString().replace("GMT", "+0000"));
  headers += header("Message-ID", `<${input.messageId}>`);
  headers += header("From", formatAddress(input.from));

  if (input.to.length) headers += header("To", formatAddressList(input.to));
  if (input.cc?.length) headers += header("Cc", formatAddressList(input.cc));
  if (input.replyTo) headers += header("Reply-To", formatAddress(input.replyTo));

  headers += header("Subject", encodeHeaderValue(input.subject));

  if (input.inReplyTo) {
    assertHeaderSafe(input.inReplyTo, "In-Reply-To");
    headers += header("In-Reply-To", `<${input.inReplyTo}>`);
  }
  if (input.references?.length) {
    for (const reference of input.references) assertHeaderSafe(reference, "References");
    // Folded: a long thread's References header easily exceeds 998 octets.
    headers += header("References", input.references.map((r) => `<${r}>`).join(`${CRLF} `));
  }

  const textPart = () =>
    header("Content-Type", 'text/plain; charset="UTF-8"') +
    header("Content-Transfer-Encoding", "quoted-printable") +
    CRLF +
    quotedPrintable(input.text);

  const htmlPart = () =>
    header("Content-Type", 'text/html; charset="UTF-8"') +
    header("Content-Transfer-Encoding", "quoted-printable") +
    CRLF +
    quotedPrintable(input.html!);

  const attachmentPart = (attachment: Attachment) => {
    assertHeaderSafe(attachment.contentType, "An attachment content type");
    // The filename is encoded, never trusted: it comes from a user and lands
    // in a header.
    const filename = encodeHeaderValue(attachment.filename.replace(/["\\]/g, ""));
    const disposition = attachment.contentId ? "inline" : "attachment";

    let part = header("Content-Type", `${attachment.contentType}; name="${filename}"`);
    part += header("Content-Transfer-Encoding", "base64");
    part += header("Content-Disposition", `${disposition}; filename="${filename}"`);
    if (attachment.contentId) {
      assertHeaderSafe(attachment.contentId, "A Content-ID");
      part += header("Content-ID", `<${attachment.contentId}>`);
    }
    return part + CRLF + base64Lines(attachment.content);
  };

  // Simplest case: one part, no multipart wrapper at all.
  if (!hasHtml && attachments.length === 0) {
    return headers + textPart();
  }

  const alternative = (): string => {
    if (!hasHtml) return textPart();
    const alt = boundary();
    let body = header("Content-Type", `multipart/alternative; boundary="${alt}"`) + CRLF;
    // Least-preferred first: a client picks the last part it understands.
    body += `--${alt}${CRLF}${textPart()}${CRLF}`;
    body += `--${alt}${CRLF}${htmlPart()}${CRLF}`;
    body += `--${alt}--${CRLF}`;
    return body;
  };

  if (attachments.length === 0) {
    return headers + alternative();
  }

  const mixed = boundary();
  let body = headers + header("Content-Type", `multipart/mixed; boundary="${mixed}"`) + CRLF;
  body += `--${mixed}${CRLF}${alternative()}${CRLF}`;
  for (const attachment of attachments) {
    body += `--${mixed}${CRLF}${attachmentPart(attachment)}${CRLF}`;
  }
  body += `--${mixed}--${CRLF}`;
  return body;
}

/**
 * Every address the transport must actually deliver to.
 *
 * Bcc appears here and nowhere in the headers — that separation is what makes
 * a blind copy blind.
 */
export function envelopeRecipients(input: MessageInput): string[] {
  const all = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
  return [...new Set(all.map((address) => address.email.toLowerCase()))];
}
