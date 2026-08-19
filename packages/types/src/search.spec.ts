import { describe, expect, it } from "vitest";
import {
  durationToMs,
  freeTextOf,
  isValidValue,
  parseQuery,
  removeTermAt,
  renderQuery,
  sizeToBytes,
  termsOf,
} from "./search";

describe("parseQuery — operators", () => {
  it("splits field:value into a term", () => {
    const terms = termsOf(parseQuery("from:alex@example.com"));
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ field: "from", value: "alex@example.com", negated: false });
  });

  it("treats a leading dash as exclusion", () => {
    expect(termsOf(parseQuery("-from:newsletter@acme.com"))[0]).toMatchObject({
      field: "from",
      negated: true,
    });
  });

  it("keeps a quoted value together as a phrase", () => {
    const [term] = termsOf(parseQuery('subject:"sprint retro"'));
    expect(term).toMatchObject({ field: "subject", value: "sprint retro", phrase: true });
  });

  it("recognises every documented operator", () => {
    const query = [
      "from:a", "to:b", "cc:c", "bcc:d", "subject:e", "filename:f.pdf",
      "label:work", "in:inbox", "is:unread", "has:attachment",
      "after:2026-08-01", "before:2026-09-01", "newer:7d", "older:1m",
      "larger:5mb", "smaller:1kb",
    ].join(" ");
    expect(termsOf(parseQuery(query))).toHaveLength(16);
  });
});

describe("parseQuery — things that are not operators", () => {
  it("keeps an unknown field as free text and reports it", () => {
    // `frm:` is a typo, not an operator. Searching for the literal text is the
    // useful behaviour; silently dropping it is not.
    const parsed = parseQuery("frm:alex");
    expect(termsOf(parsed)).toHaveLength(0);
    expect(freeTextOf(parsed)).toBe("frm:alex");
    expect(parsed.unknownFields).toEqual([{ name: "frm", start: 0, end: 8 }]);
  });

  it("keeps a known field with an invalid value as free text", () => {
    // `is:` has a closed vocabulary; `is:banana` is not a filter.
    const parsed = parseQuery("is:banana");
    expect(termsOf(parsed)).toHaveLength(0);
    expect(freeTextOf(parsed)).toBe("is:banana");
    // The field name is real, so it is not reported as unknown.
    expect(parsed.unknownFields).toEqual([]);
  });

  it("does not treat a bare colon or a time as a field", () => {
    expect(termsOf(parseQuery(":30"))).toHaveLength(0);
    expect(freeTextOf(parseQuery("meeting at 10:30"))).toContain("10:30");
  });

  it("never throws on a half-typed query", () => {
    for (const partial of ["f", "fr", "from", "from:", 'subject:"unterminated', "-", "OR", "a OR"]) {
      expect(() => parseQuery(partial)).not.toThrow();
    }
  });
});

describe("parseQuery — boolean grouping", () => {
  it("ANDs separate terms into separate groups", () => {
    expect(parseQuery("from:alex has:attachment").groups).toHaveLength(2);
  });

  it("ORs terms joined by OR into one group", () => {
    const { groups } = parseQuery("from:alex OR from:sarah");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("reads `a OR b c` as (a OR b) AND c, the way every mail client does", () => {
    const { groups } = parseQuery("from:alex OR from:sarah has:attachment");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });

  it("is case-insensitive about the OR keyword but not about values", () => {
    expect(parseQuery("from:a or from:b").groups).toHaveLength(1);
    expect(termsOf(parseQuery("from:Alex"))[0]!.value).toBe("Alex");
  });
});

describe("renderQuery", () => {
  it("round-trips a query unchanged", () => {
    for (const query of [
      "from:alex has:attachment",
      "from:alex OR from:sarah",
      '-subject:"out of office"',
      "budget report",
    ]) {
      expect(renderQuery(parseQuery(query))).toBe(query);
    }
  });

  it("re-quotes a value containing whitespace", () => {
    expect(renderQuery(parseQuery('subject:"sprint retro"'))).toBe('subject:"sprint retro"');
  });
});

describe("removeTermAt", () => {
  it("removes the chip's own text and tidies the spacing", () => {
    const input = "from:alex has:attachment budget";
    const [term] = termsOf(parseQuery(input));
    expect(removeTermAt(input, term!.start, term!.end)).toBe("has:attachment budget");
  });
});

describe("isValidValue", () => {
  it("accepts only the closed vocabulary for is: and has:", () => {
    expect(isValidValue("is", "unread")).toBe(true);
    expect(isValidValue("is", "UNREAD")).toBe(true);
    expect(isValidValue("is", "banana")).toBe(false);
    expect(isValidValue("has", "attachment")).toBe(true);
    expect(isValidValue("has", "banana")).toBe(false);
  });

  it("requires ISO dates for after: and before:", () => {
    expect(isValidValue("after", "2026-08-01")).toBe(true);
    expect(isValidValue("after", "01/08/2026")).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(isValidValue("from", "")).toBe(false);
  });
});

describe("durationToMs", () => {
  it("converts the documented units", () => {
    expect(durationToMs("7d")).toBe(7 * 86_400_000);
    expect(durationToMs("2w")).toBe(2 * 604_800_000);
    expect(durationToMs("1y")).toBe(31_536_000_000);
  });

  it("returns null for anything else", () => {
    expect(durationToMs("7")).toBeNull();
    expect(durationToMs("banana")).toBeNull();
  });
});

describe("sizeToBytes", () => {
  it("converts the documented units, defaulting to bytes", () => {
    expect(sizeToBytes("5mb")).toBe(5 * 1_048_576);
    expect(sizeToBytes("1KB")).toBe(1024);
    expect(sizeToBytes("2048")).toBe(2048);
    expect(sizeToBytes("1.5gb")).toBe(Math.round(1.5 * 1_073_741_824));
  });

  it("returns null for anything else", () => {
    expect(sizeToBytes("big")).toBeNull();
  });
});
