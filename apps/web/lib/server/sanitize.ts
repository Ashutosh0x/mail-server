import sanitizeHtml from "sanitize-html";

/**
 * HTML sanitisation for composed mail.
 *
 * Delegated to `sanitize-html` rather than hand-written. This is the same
 * judgement as WebAuthn: a sanitiser is security-critical, the bypass surface
 * is enormous (mXSS, mutation through the parser, namespace confusion in SVG,
 * entity tricks), and a hand-rolled one is a vulnerability you have not found
 * yet. The value we add is the POLICY, not the parser.
 *
 * Applied on the SERVER, on the way in. The composer also renders trusted
 * markup, but a client-side sanitiser protects nobody — anything can POST to
 * the API directly, so the boundary has to be here.
 *
 * Not `server-only`: pure string work, and keeping it importable makes the
 * policy exhaustively testable, which for this file matters.
 */

/**
 * What a composed message may contain.
 *
 * Allow-list, never a block-list: a block-list is a promise to have thought of
 * every dangerous tag, and HTML keeps adding them.
 *
 * Deliberately absent, and why:
 *   script, iframe, object, embed, form  — executable or interactive
 *   style                                — CSS can exfiltrate and can obscure
 *   svg, math                            — parser-confusion (mXSS) vectors
 *   input, button, select                — no interactive content in mail
 */
const ALLOWED_TAGS = [
  "p", "div", "span", "br", "hr",
  "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "a",
  "img",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
];

/**
 * URL schemes permitted on a link.
 *
 * `javascript:` is the obvious exclusion. `data:` is excluded too — a
 * `data:text/html` URL is a same-origin script in a link, and nothing a user
 * composes legitimately needs one.
 */
const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

const POLICY: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // `rel` must be listed here or the transform below adds it and the
    // attribute filter immediately strips it again.
    a: ["href", "title", "rel"],
    // `cid:` references an inline attachment part in the assembled message.
    img: ["src", "alt", "width", "height"],
    "*": ["dir", "lang"],
  },
  allowedSchemes: ALLOWED_SCHEMES,
  // `cid:` is only meaningful on an image, so it is permitted there and
  // nowhere else — a `cid:` link would be inert at best and confusing at worst.
  allowedSchemesByTag: { img: [...ALLOWED_SCHEMES, "cid"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  // Strip the CONTENT of these too, not just the tags: leaving the text of a
  // <script> block behind dumps code into the message body.
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  // Anything not allowed has its tag removed but its text kept, so a user
  // never silently loses words they wrote.
  disallowedTagsMode: "discard",
  allowedClasses: {},
  // No inline styles at all. CSS in mail is a well-worn exfiltration and
  // obfuscation channel, and the formatting this composer offers is expressed
  // through tags instead.
  allowedStyles: {},
  transformTags: {
    // Outbound links open in a new context on the recipient's side; adding
    // rel here costs nothing and blocks reverse-tabnabbing in any client that
    // honours it.
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
};

/**
 * Sanitise a composed message body.
 *
 * Runs twice. The second pass is not superstition: mutation-XSS works by
 * producing markup that is harmless in one parse and dangerous after the
 * browser re-parses the serialised output. If a second pass changes anything,
 * the first result was not a fixed point, and the fixed point is what gets
 * stored.
 */
export function sanitizeMessageHtml(html: string): string {
  const once = sanitizeHtml(html, POLICY);
  const twice = sanitizeHtml(once, POLICY);
  return twice;
}

/**
 * True when sanitising changed the input.
 *
 * Used to tell a user their formatting was altered, rather than silently
 * rewriting what they wrote.
 */
export function wasSanitized(html: string): boolean {
  return sanitizeMessageHtml(html) !== html;
}

/**
 * Whether a URL is safe to put in an href.
 *
 * Checked separately from the sanitiser because the link dialog needs to
 * refuse a bad URL at the moment it is typed, not silently drop it later.
 *
 * Leading control characters and whitespace are stripped first: browsers
 * ignore them when resolving a scheme, so `java\tscript:` is `javascript:`.
 */
export function isSafeUrl(url: string): boolean {
  const cleaned = url.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
  if (cleaned.length === 0) return false;

  // A relative or anchor URL has no scheme to abuse.
  if (!/^[a-z][a-z0-9+.-]*:/.test(cleaned)) return true;

  return ALLOWED_SCHEMES.some((scheme) => cleaned.startsWith(`${scheme}:`));
}
