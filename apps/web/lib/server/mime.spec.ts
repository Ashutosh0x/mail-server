import { describe, expect, it } from "vitest";
import {
  buildMessage,
  encodeHeaderValue,
  envelopeRecipients,
  formatAddress,
  htmlToText,
  isHeaderSafe,
  isValidAddress,
  MimeError,
  newMessageId,
  quotedPrintable,
  type MessageInput,
} from "./mime";

const base: MessageInput = {
  from: { name: "Ada Lovelace", email: "ada@example.com" },
  to: [{ name: "Alan Turing", email: "alan@example.org" }],
  subject: "Notes on the Analytical Engine",
  text: "The engine weaves algebraic patterns.",
  messageId: "abc123@example.com",
  date: new Date("2026-08-20T10:00:00Z"),
};

// ── Header injection ───────────────────────────────────────────────────────

describe("header injection", () => {
  it("refuses a newline in a display name", () => {
    // The classic: a name that closes the header and opens a new one.
    expect(() =>
      formatAddress({ name: "Ada\r\nBcc: victim@example.com", email: "ada@example.com" })
    ).toThrow(MimeError);
  });

  it("refuses a bare LF as well as CRLF", () => {
    expect(() => formatAddress({ name: "Ada\nBcc: x@y.com", email: "ada@example.com" })).toThrow(MimeError);
  });

  it("refuses Unicode line separators, which some parsers treat as breaks", () => {
    for (const breaker of [" ", " ", "\0"]) {
      expect(isHeaderSafe(`Ada${breaker}Bcc: x@y.com`), JSON.stringify(breaker)).toBe(false);
    }
  });

  it("refuses a newline in the subject", () => {
    expect(() => buildMessage({ ...base, subject: "Hi\r\nBcc: victim@example.com" })).toThrow(MimeError);
  });

  it("refuses a newline in an address", () => {
    expect(isValidAddress("ada\r\nBcc: x@y.com@example.com")).toBe(false);
  });

  it("refuses a newline in In-Reply-To and References", () => {
    expect(() => buildMessage({ ...base, inReplyTo: "x\r\nBcc: v@e.com" })).toThrow(MimeError);
    expect(() => buildMessage({ ...base, references: ["ok@e.com", "x\r\nBcc: v@e.com"] })).toThrow(MimeError);
  });

  it("quotes a display name containing specials rather than emitting it raw", () => {
    const formatted = formatAddress({ name: 'Ada "The Countess", Lovelace', email: "ada@example.com" });
    expect(formatted.startsWith('"')).toBe(true);
    // The inner quotes are escaped, so the quoted-string cannot be closed early.
    expect(formatted).toContain('\\"');
  });
});

// ── Address validation ─────────────────────────────────────────────────────

describe("isValidAddress", () => {
  it("accepts ordinary addresses", () => {
    for (const address of [
      "ada@example.com",
      "ada.lovelace@example.co.uk",
      "ada+tag@example.com",
      "a@b.co",
      "first.last+filter@sub.domain.example.com",
    ]) {
      expect(isValidAddress(address), address).toBe(true);
    }
  });

  it("rejects malformed addresses", () => {
    for (const address of [
      "",
      "no-at-sign",
      "@example.com",
      "ada@",
      "ada@@example.com",
      "ada@.com",
      "ada@com.",
      "ada@-example.com",
      "ada@example-.com",
      ".ada@example.com",
      "ada.@example.com",
      "ada..lovelace@example.com",
      "ada@example..com",
      // No dot in the domain: valid per the grammar, never what a user meant.
      "ada@localhost",
      "ada lovelace@example.com",
      "<ada@example.com>",
    ]) {
      expect(isValidAddress(address), address).toBe(false);
    }
  });

  it("enforces the RFC length limits", () => {
    expect(isValidAddress("a".repeat(65) + "@example.com")).toBe(false);
    expect(isValidAddress("a@" + "b".repeat(64) + ".com")).toBe(false);
    expect(isValidAddress("a".repeat(250) + "@example.com")).toBe(false);
  });

  it("does not degrade on a hostile input", () => {
    // Bounded scanning, so no catastrophic backtracking.
    const started = Date.now();
    isValidAddress("a".repeat(1000) + "!".repeat(1000) + "@" + "b".repeat(1000));
    expect(Date.now() - started).toBeLessThan(50);
  });
});

// ── Encoding ───────────────────────────────────────────────────────────────

describe("encodeHeaderValue", () => {
  it("leaves pure ASCII alone", () => {
    expect(encodeHeaderValue("Simple subject")).toBe("Simple subject");
  });

  it("encodes non-ASCII as an RFC 2047 word", () => {
    expect(encodeHeaderValue("Привет")).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  });

  it("round-trips through the encoding", () => {
    const original = "Grüße, 世界 🎉";
    const encoded = encodeHeaderValue(original);
    const decoded = encoded
      .split("\r\n ")
      .map((word) => Buffer.from(word.replace(/^=\?UTF-8\?B\?|\?=$/g, ""), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(original);
  });

  it("keeps every encoded-word within the 75-character limit", () => {
    const encoded = encodeHeaderValue("日本語のとても長い件名がここにあります".repeat(5));
    for (const word of encoded.split("\r\n ")) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a multi-byte character across two words", () => {
    const original = "🎉".repeat(40);
    const encoded = encodeHeaderValue(original);
    const decoded = encoded
      .split("\r\n ")
      .map((word) => Buffer.from(word.replace(/^=\?UTF-8\?B\?|\?=$/g, ""), "base64").toString("utf8"))
      .join("");
    // A split surrogate pair would show up as replacement characters.
    expect(decoded).toBe(original);
    expect(decoded).not.toContain("�");
  });
});

describe("quotedPrintable", () => {
  it("leaves plain ASCII readable", () => {
    expect(quotedPrintable("Hello world")).toBe("Hello world");
  });

  it("escapes the equals sign, which is the escape character", () => {
    expect(quotedPrintable("a=b")).toBe("a=3Db");
  });

  it("encodes non-ASCII bytes", () => {
    expect(quotedPrintable("é")).toBe("=C3=A9");
  });

  it("normalises a bare LF to CRLF", () => {
    expect(quotedPrintable("a\nb")).toBe("a\r\nb");
  });

  it("does not double a CRLF that is already correct", () => {
    expect(quotedPrintable("a\r\nb")).toBe("a\r\nb");
  });

  it("keeps every line within the 76-character limit", () => {
    for (const line of quotedPrintable("x".repeat(500)).split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

// ── Message-ID ─────────────────────────────────────────────────────────────

describe("newMessageId", () => {
  it("is unique per call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newMessageId("example.com")));
    expect(ids.size).toBe(50);
  });

  it("is shaped like a Message-ID without the angle brackets", () => {
    const id = newMessageId("example.com");
    expect(id).toMatch(/^[0-9a-f-]{36}@example\.com$/);
    expect(id).not.toContain("<");
  });

  it("refuses a domain that could break out of the header", () => {
    for (const domain of ["example.com\r\nBcc: x@y.com", "a@b.com", "example.com>"]) {
      expect(() => newMessageId(domain), domain).toThrow(MimeError);
    }
  });
});

// ── Plain text from HTML ───────────────────────────────────────────────────

describe("htmlToText", () => {
  it("keeps paragraphs as blank-line-separated blocks", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
  });

  it("keeps list structure with bullets", () => {
    expect(htmlToText("<ul><li>A</li><li>B</li></ul>")).toContain("• A");
    expect(htmlToText("<ul><li>A</li><li>B</li></ul>")).toContain("• B");
  });

  it("keeps a link's destination", () => {
    expect(htmlToText('<a href="https://example.com">Example</a>')).toBe("Example <https://example.com>");
  });

  it("does not repeat a URL that is already its own label", () => {
    expect(htmlToText('<a href="https://example.com">https://example.com</a>')).toBe("https://example.com");
  });

  it("keeps the quote marker on quoted text", () => {
    expect(htmlToText("<blockquote>Quoted</blockquote>")).toContain("> Quoted");
  });

  it("drops script and style content entirely", () => {
    const text = htmlToText("<p>Safe</p><script>alert(1)</script><style>body{}</style>");
    expect(text).toBe("Safe");
    expect(text).not.toContain("alert");
  });

  it("decodes entities after stripping tags, so an encoded tag stays inert", () => {
    // If entities were decoded first, `&lt;script&gt;` would become a real tag
    // and then be stripped — losing the text the sender actually wrote.
    expect(htmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<script>alert(1)</script>");
  });

  it("converts br to a single newline", () => {
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });

  it("collapses excessive blank lines", () => {
    expect(htmlToText("<p>A</p><p></p><p></p><p>B</p>")).toBe("A\n\nB");
  });
});

// ── Message structure ──────────────────────────────────────────────────────

describe("buildMessage", () => {
  it("emits CRLF line endings throughout", () => {
    const message = buildMessage(base);
    // A bare LF is the most common reason an MTA mangles or rejects a message.
    expect(message.split("\r\n").length).toBeGreaterThan(1);
    expect(/[^\r]\n/.test(message)).toBe(false);
  });

  it("emits text/plain alone when there is nothing else", () => {
    const message = buildMessage(base);
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(message).not.toContain("multipart");
  });

  it("uses multipart/alternative for text plus HTML", () => {
    const message = buildMessage({ ...base, html: "<p>Hello</p>" });
    expect(message).toContain("multipart/alternative");
    expect(message).toContain("text/plain");
    expect(message).toContain("text/html");
  });

  it("puts the plain-text part before the HTML one", () => {
    // A client picks the LAST part it understands, so HTML must come second.
    const message = buildMessage({ ...base, html: "<p>Hello</p>" });
    expect(message.indexOf("text/plain")).toBeLessThan(message.indexOf("text/html"));
  });

  it("uses multipart/mixed when there are attachments", () => {
    const message = buildMessage({
      ...base,
      attachments: [{ filename: "a.txt", contentType: "text/plain", content: Buffer.from("hi") }],
    });
    expect(message).toContain("multipart/mixed");
    expect(message).toContain('filename="a.txt"');
    expect(message).toContain("Content-Transfer-Encoding: base64");
  });

  it("nests alternative inside mixed for text, HTML and attachments", () => {
    const message = buildMessage({
      ...base,
      html: "<p>Hello</p>",
      attachments: [{ filename: "a.txt", contentType: "text/plain", content: Buffer.from("hi") }],
    });
    expect(message.indexOf("multipart/mixed")).toBeLessThan(message.indexOf("multipart/alternative"));
  });

  it("marks an inline image with a Content-ID and inline disposition", () => {
    const message = buildMessage({
      ...base,
      html: '<img src="cid:img1">',
      attachments: [
        { filename: "i.png", contentType: "image/png", content: Buffer.from([0x89]), contentId: "img1" },
      ],
    });
    expect(message).toContain("Content-ID: <img1>");
    expect(message).toContain("Content-Disposition: inline");
  });

  it("closes every multipart boundary", () => {
    const message = buildMessage({
      ...base,
      html: "<p>x</p>",
      attachments: [{ filename: "a.txt", contentType: "text/plain", content: Buffer.from("hi") }],
    });
    const boundaries = [...message.matchAll(/boundary="([^"]+)"/g)].map((m) => m[1]!);
    expect(boundaries.length).toBe(2);
    for (const boundary of boundaries) {
      expect(message, boundary).toContain(`--${boundary}--`);
    }
  });

  it("requires at least one recipient", () => {
    expect(() => buildMessage({ ...base, to: [] })).toThrow(MimeError);
  });

  it("includes the mandatory headers", () => {
    const message = buildMessage(base);
    for (const header of ["MIME-Version:", "Date:", "Message-ID:", "From:", "To:", "Subject:"]) {
      expect(message, header).toContain(header);
    }
  });

  it("wraps the Message-ID in angle brackets", () => {
    expect(buildMessage(base)).toContain("Message-ID: <abc123@example.com>");
  });
});

// ── Bcc ────────────────────────────────────────────────────────────────────

describe("blind copies", () => {
  it("never writes Bcc into the headers", () => {
    // Writing it there is the classic way to disclose a blind copy to
    // everyone on the message.
    const message = buildMessage({ ...base, bcc: [{ email: "secret@example.com" }] });
    expect(message).not.toContain("Bcc");
    expect(message).not.toContain("secret@example.com");
  });

  it("still delivers to a Bcc recipient through the envelope", () => {
    const recipients = envelopeRecipients({ ...base, bcc: [{ email: "secret@example.com" }] });
    expect(recipients).toContain("secret@example.com");
  });

  it("de-duplicates a recipient listed twice", () => {
    const recipients = envelopeRecipients({
      ...base,
      to: [{ email: "a@example.com" }],
      cc: [{ email: "A@example.com" }],
    });
    expect(recipients).toEqual(["a@example.com"]);
  });
});
