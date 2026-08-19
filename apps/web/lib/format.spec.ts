import { describe, expect, it } from "vitest";
import { formatBytes, formatListTimestamp, initialsOf, senderLabel } from "./format";

const NOW = new Date("2026-08-19T15:00:00Z");

describe("senderLabel", () => {
  it("prefers the display name", () => {
    expect(senderLabel([{ name: "Alex Chen", email: "alex@acme.com" }])).toBe("Alex Chen");
  });

  it("falls back to the local part when there is no name", () => {
    expect(senderLabel([{ name: null, email: "alex@acme.com" }])).toBe("alex");
    expect(senderLabel([{ name: "   ", email: "alex@acme.com" }])).toBe("alex");
  });

  it("says so rather than rendering an empty row", () => {
    expect(senderLabel([])).toBe("(unknown sender)");
  });
});

describe("initialsOf", () => {
  it("takes first and last initials", () => {
    expect(initialsOf("Alex Chen")).toBe("AC");
    expect(initialsOf("Maria del Carmen Ruiz")).toBe("MR");
  });

  it("uses two letters for a single word", () => {
    expect(initialsOf("GitHub")).toBe("GI");
  });

  it("never returns an empty tile", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("formatListTimestamp", () => {
  // `now` is injected so these do not fail at midnight or in another timezone.
  it("shows a time for today", () => {
    expect(formatListTimestamp("2026-08-19T09:15:00Z", NOW)).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it("shows a weekday within the last week", () => {
    expect(formatListTimestamp("2026-08-17T09:15:00Z", NOW)).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  });

  it("shows a date beyond a week, and adds the year beyond this one", () => {
    expect(formatListTimestamp("2026-06-01T09:15:00Z", NOW)).toBe("Jun 1");
    expect(formatListTimestamp("2025-06-01T09:15:00Z", NOW)).toBe("Jun 1, 2025");
  });

  it("returns empty rather than 'Invalid Date' for a malformed value", () => {
    expect(formatListTimestamp("not-a-date", NOW)).toBe("");
  });
});

describe("formatBytes", () => {
  it("keeps attachment sizes short", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(251_904)).toBe("246 KB");
    expect(formatBytes(4_194_304)).toBe("4.0 MB");
  });

  it("switches from one decimal to none once the number is wide", () => {
    expect(formatBytes(9.5 * 1024)).toBe("9.5 KB");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
  });

  it("returns empty for nonsense rather than NaN", () => {
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(-1)).toBe("");
  });
});
