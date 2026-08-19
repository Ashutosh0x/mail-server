/**
 * File type detection from content, plus filename sanitisation.
 *
 * The browser-supplied `Content-Type` is a claim by the uploader, and the
 * extension is a claim by whoever named the file. Neither is evidence. This
 * module decides the type from the leading bytes and records what was claimed
 * separately, so a `.pdf` that is really a Windows executable is stored, served
 * and displayed as an executable.
 *
 * Pure and dependency-free so it can be unit-tested without a filesystem.
 */

export interface DetectedType {
  /** What the bytes say. `application/octet-stream` when nothing matched. */
  mime: string;
  /** Set when the declared type and the detected type disagree meaningfully. */
  mismatch: boolean;
  /** True for formats that execute or can carry executable content. */
  executable: boolean;
}

interface Signature {
  mime: string;
  /** Byte prefix, with `null` meaning "any byte" for variable headers. */
  magic: (number | null)[];
  offset?: number;
  executable?: boolean;
}

/**
 * Ordered longest-first so a specific match wins over a generic prefix — a
 * DOCX is a ZIP, and reporting it as a ZIP would be true but useless.
 */
const SIGNATURES: Signature[] = [
  { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
  { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/bmp", magic: [0x42, 0x4d] },
  { mime: "image/tiff", magic: [0x49, 0x49, 0x2a, 0x00] },
  { mime: "image/tiff", magic: [0x4d, 0x4d, 0x00, 0x2a] },
  { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: "application/gzip", magic: [0x1f, 0x8b] },
  { mime: "application/x-bzip2", magic: [0x42, 0x5a, 0x68] },
  { mime: "application/x-7z-compressed", magic: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { mime: "application/vnd.rar", magic: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { mime: "application/x-xz", magic: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { mime: "application/zip", magic: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/zip", magic: [0x50, 0x4b, 0x05, 0x06] },
  { mime: "video/mp4", magic: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: "video/x-matroska", magic: [0x1a, 0x45, 0xdf, 0xa3] },
  { mime: "audio/mpeg", magic: [0x49, 0x44, 0x33] },
  { mime: "audio/flac", magic: [0x66, 0x4c, 0x61, 0x43] },
  { mime: "application/ogg", magic: [0x4f, 0x67, 0x67, 0x53] },
  { mime: "font/woff2", magic: [0x77, 0x4f, 0x46, 0x32] },
  { mime: "font/woff", magic: [0x77, 0x4f, 0x46, 0x46] },
  { mime: "application/x-msdownload", magic: [0x4d, 0x5a], executable: true },
  { mime: "application/x-elf", magic: [0x7f, 0x45, 0x4c, 0x46], executable: true },
  { mime: "application/x-mach-binary", magic: [0xcf, 0xfa, 0xed, 0xfe], executable: true },
  { mime: "application/java-archive", magic: [0xca, 0xfe, 0xba, 0xbe], executable: true },
  { mime: "application/x-shockwave-flash", magic: [0x43, 0x57, 0x53], executable: true },
].sort((a, b) => b.magic.length + (b.offset ?? 0) - (a.magic.length + (a.offset ?? 0)));

/** Types the browser must never be told to render inline. */
const NEVER_INLINE = new Set([
  "text/html",
  "image/svg+xml",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "application/x-msdownload",
  "application/x-elf",
  "application/x-mach-binary",
  "application/java-archive",
  "application/x-shockwave-flash",
]);

function matches(head: Uint8Array, signature: Signature): boolean {
  const offset = signature.offset ?? 0;
  if (head.length < offset + signature.magic.length) return false;
  return signature.magic.every((byte, i) => byte === null || head[offset + i] === byte);
}

/**
 * Whether the buffer is plausibly UTF-8 text.
 *
 * Two conditions, and both are needed. Rejecting control bytes alone would call
 * 0xDEADBEEF text, because none of those bytes is a control character — so the
 * content must also decode as UTF-8. The decode is `fatal` so an invalid
 * sequence throws rather than yielding replacement characters.
 */
function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  for (const byte of head) {
    // NUL, or a C0 control that is not tab/LF/CR, means binary.
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  try {
    // The tail of a 4 KB window can split a multi-byte character, so trim back
    // to the last plausible boundary before deciding.
    let end = head.length;
    while (end > 0 && (head[end - 1]! & 0xc0) === 0x80) end--;
    if (end > 0 && (head[end - 1]! & 0x80) !== 0) end--;
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect from the first bytes of the file. 4 KB is enough for every signature
 * here and is the amount worth buffering before deciding.
 */
export function detectType(head: Uint8Array, declaredType: string | null): DetectedType {
  for (const signature of SIGNATURES) {
    if (matches(head, signature)) {
      const mime = signature.mime;
      return {
        mime,
        mismatch: normaliseDeclared(declaredType) !== mime,
        executable: signature.executable === true,
      };
    }
  }

  if (looksLikeText(head)) {
    // Text is where the declared type is worth honouring — text/csv and
    // text/markdown have no magic bytes and the extension is the only signal.
    // It is still never served inline; see `safeDisposition`.
    const declared = normaliseDeclared(declaredType);
    const mime = declared?.startsWith("text/") || declared === "application/json" ? declared : "text/plain";
    return { mime, mismatch: false, executable: false };
  }

  return { mime: "application/octet-stream", mismatch: declaredType !== null, executable: false };
}

function normaliseDeclared(declared: string | null): string | null {
  if (!declared) return null;
  return declared.split(";")[0]!.trim().toLowerCase() || null;
}

/**
 * Strip a filename down to something safe to store and to put in a header.
 *
 * Removes directory separators, NUL, control characters and leading dots, and
 * caps the length. A name is display data, never a path component.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw
    // Windows separators first, so a path is split the same way either way.
    .split("\\")
    .join("/")
    .split("/")
    .pop()!
    .split("")
    // Drop NUL, C0 and DEL by code point. A regex character class would need
    // literal control characters in this file, which makes the source binary
    // to every tool that reads it — including the editors that then mangle it.
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .replace(/^\.+/, "")
    .trim();

  const cleaned = base.length > 0 ? base : "attachment";
  // Windows reserves these regardless of extension.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  const safe = reserved.test(cleaned) ? `file-${cleaned}` : cleaned;
  return safe.length > 255 ? safe.slice(0, 200) + safe.slice(-55) : safe;
}

/**
 * The `Content-Disposition` and effective type for a download.
 *
 * Anything that could execute in the origin — HTML, SVG, XML — is forced to
 * `attachment` and re-typed to octet-stream. Serving a user-supplied SVG inline
 * from the app's own origin is stored XSS with extra steps.
 */
export function safeDisposition(mime: string, filename: string): { disposition: string; contentType: string } {
  const inlineSafe = !NEVER_INLINE.has(mime) && (mime.startsWith("image/") || mime === "application/pdf");
  const encoded = encodeURIComponent(filename);
  return {
    disposition: `${inlineSafe ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
    contentType: NEVER_INLINE.has(mime) ? "application/octet-stream" : mime,
  };
}

/** Bytes of the head worth buffering before a type decision. */
export const HEAD_BYTES = 4096;
