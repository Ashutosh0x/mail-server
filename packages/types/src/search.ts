/**
 * The search query grammar.
 *
 * Lives in the contract package because it *is* contract: the composer turns
 * typed text into filter chips with it, and the API turns the same text into a
 * query with it. Two implementations of "what does `from:a OR from:b` mean"
 * would let the chips a user sees disagree with the results they get.
 *
 * Pure and dependency-free, so the server can run it too.
 */

export type SearchField =
  | "from" | "to" | "cc" | "bcc" | "subject" | "body"
  | "filename" | "label" | "in" | "is" | "has"
  | "after" | "before" | "newer" | "older"
  | "larger" | "smaller" | "size";

/** Field names that take a free-text value. */
const TEXT_FIELDS = new Set<SearchField>(["from", "to", "cc", "bcc", "subject", "body", "filename", "label", "in"]);
/** Field names whose value comes from a closed set. */
const ENUM_FIELDS: Partial<Record<SearchField, readonly string[]>> = {
  is: ["unread", "read", "starred", "flagged", "important", "draft", "snoozed", "muted"],
  has: ["attachment", "link", "image", "calendar"],
};
/** Field names taking an absolute date. */
const DATE_FIELDS = new Set<SearchField>(["after", "before"]);
/** Field names taking a relative duration such as `7d`. */
const DURATION_FIELDS = new Set<SearchField>(["newer", "older"]);
/** Field names taking a byte size such as `5mb`. */
const SIZE_FIELDS = new Set<SearchField>(["larger", "smaller", "size"]);

const ALL_FIELDS = new Set<string>([
  ...TEXT_FIELDS,
  ...Object.keys(ENUM_FIELDS),
  ...DATE_FIELDS,
  ...DURATION_FIELDS,
  ...SIZE_FIELDS,
]);

/** One `field:value` constraint, as rendered by a filter chip. */
export interface SearchTerm {
  kind: "term";
  field: SearchField;
  value: string;
  /** `-from:x` — exclude rather than require. */
  negated: boolean;
  /** Value was quoted, so it must match as a phrase. */
  phrase: boolean;
  /** Byte offsets in the source string, so a chip can edit its own text. */
  start: number;
  end: number;
}

/** Bare words with no `field:` prefix — matched against subject and body. */
export interface SearchText {
  kind: "text";
  value: string;
  negated: boolean;
  phrase: boolean;
  start: number;
  end: number;
}

export type SearchNode = SearchTerm | SearchText;

/**
 * A parsed query: groups of nodes, where nodes inside a group are OR-ed and the
 * groups themselves are AND-ed.
 *
 * `a OR b c` therefore means `(a OR b) AND c`, which is what every mail client
 * does and what users expect, even though a strict precedence reading of the
 * same tokens could argue for `a OR (b AND c)`.
 */
export interface ParsedQuery {
  groups: SearchNode[][];
  /** Terms whose field looked like an operator but is not one, kept so the UI
   *  can say so instead of silently searching for the literal text. */
  unknownFields: { name: string; start: number; end: number }[];
}

interface RawToken {
  text: string;
  start: number;
  end: number;
  quoted: boolean;
}

/** Split on whitespace, keeping quoted runs together and recording offsets. */
function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;

    const start = i;
    let text = "";
    let quoted = false;

    // A leading `-` or `field:` may precede the quote: -subject:"a b"
    while (i < input.length && !/\s/.test(input[i]!)) {
      if (input[i] === '"') {
        quoted = true;
        i++;
        while (i < input.length && input[i] !== '"') text += input[i++];
        i++; // closing quote, or end of input for an unterminated one
        continue;
      }
      text += input[i++];
    }
    tokens.push({ text, start, end: i, quoted });
  }
  return tokens;
}

/** Whether `value` is well-formed for `field`. Unparseable values stay as text. */
export function isValidValue(field: SearchField, value: string): boolean {
  if (value === "") return false;
  const allowed = ENUM_FIELDS[field];
  if (allowed) return allowed.includes(value.toLowerCase());
  if (DATE_FIELDS.has(field)) return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (DURATION_FIELDS.has(field)) return /^\d+[dwmy]$/i.test(value);
  if (SIZE_FIELDS.has(field)) return /^\d+(\.\d+)?(b|kb|mb|gb)?$/i.test(value);
  return true;
}

/**
 * Parse a search string into groups.
 *
 * Never throws. A malformed query is a query the user is still typing, and a
 * search box that goes red halfway through every word is unusable — anything
 * unrecognised degrades to free text.
 */
export function parseQuery(input: string): ParsedQuery {
  const groups: SearchNode[][] = [];
  const unknownFields: ParsedQuery["unknownFields"] = [];
  let current: SearchNode[] = [];
  let pendingOr = false;

  for (const token of tokenize(input)) {
    if (token.text === "" && !token.quoted) continue;

    if (!token.quoted && token.text.toUpperCase() === "OR") {
      // The next node joins the group just closed rather than starting a new one.
      pendingOr = true;
      continue;
    }

    let rest = token.text;
    let negated = false;
    if (rest.startsWith("-") && rest.length > 1) {
      negated = true;
      rest = rest.slice(1);
    }

    const colon = rest.indexOf(":");
    let node: SearchNode;

    if (colon > 0) {
      const name = rest.slice(0, colon).toLowerCase();
      const value = rest.slice(colon + 1);
      if (ALL_FIELDS.has(name) && isValidValue(name as SearchField, value)) {
        node = {
          kind: "term",
          field: name as SearchField,
          value,
          negated,
          phrase: token.quoted,
          start: token.start,
          end: token.end,
        };
      } else {
        if (!ALL_FIELDS.has(name)) {
          unknownFields.push({ name, start: token.start, end: token.end });
        }
        node = { kind: "text", value: rest, negated, phrase: token.quoted, start: token.start, end: token.end };
      }
    } else {
      node = { kind: "text", value: rest, negated, phrase: token.quoted, start: token.start, end: token.end };
    }

    if (pendingOr && groups.length > 0 && current.length === 0) {
      // `a OR b`: reopen the previous group and add to it.
      current = groups.pop()!;
    } else if (pendingOr && current.length > 0) {
      // `a b OR c`: only the immediately preceding node participates in the OR.
      // Nothing to do — the node joins `current`, which already holds it.
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(node);
    pendingOr = false;
  }

  if (current.length > 0) groups.push(current);
  return { groups, unknownFields };
}

/** Render a parsed query back to a string. `parse(render(parse(x)))` is stable. */
export function renderQuery(query: ParsedQuery): string {
  return query.groups
    .map((group) =>
      group
        .map((node) => {
          const sign = node.negated ? "-" : "";
          const value = node.phrase || /\s/.test(node.value) ? `"${node.value}"` : node.value;
          return node.kind === "term" ? `${sign}${node.field}:${value}` : `${sign}${value}`;
        })
        .join(" OR ")
    )
    .join(" ");
}

/** Every `field:value` constraint, flattened — what the chip row renders. */
export function termsOf(query: ParsedQuery): SearchTerm[] {
  return query.groups.flat().filter((n): n is SearchTerm => n.kind === "term");
}

/** The free-text remainder, joined — what gets full-text searched. */
export function freeTextOf(query: ParsedQuery): string {
  return query.groups
    .flat()
    .filter((n): n is SearchText => n.kind === "text")
    .map((n) => n.value)
    .join(" ")
    .trim();
}

/** Remove one term by its source offset, for a chip's `✕` button. */
export function removeTermAt(input: string, start: number, end: number): string {
  return (input.slice(0, start) + input.slice(end)).replace(/\s{2,}/g, " ").trim();
}

// ── Relative durations ─────────────────────────────────────────────────────

const DURATION_MS: Record<string, number> = {
  d: 86_400_000,
  w: 604_800_000,
  m: 2_592_000_000, // 30 days — calendar months are not a fixed span
  y: 31_536_000_000, // 365 days
};

/** `7d` → milliseconds. Null when the token is not a duration. */
export function durationToMs(value: string): number | null {
  const match = /^(\d+)([dwmy])$/i.exec(value);
  if (!match) return null;
  return Number(match[1]) * DURATION_MS[match[2]!.toLowerCase()]!;
}

const SIZE_MULTIPLIER: Record<string, number> = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824 };

/** `5mb` → bytes. Null when the token is not a size. */
export function sizeToBytes(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/i.exec(value);
  if (!match) return null;
  const unit = (match[2] ?? "b").toLowerCase();
  return Math.round(Number(match[1]) * SIZE_MULTIPLIER[unit]!);
}
