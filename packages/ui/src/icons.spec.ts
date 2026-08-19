import { describe, expect, it } from "vitest";
import { icons, iconForMimeType, fileType, calendar } from "./icons";

/**
 * The registry exists so a lucide rename is one edit rather than three hundred.
 * These tests are what make that true: if an upgrade drops or renames an icon,
 * the entry becomes `undefined` and this fails — instead of React rendering
 * nothing and the gap being noticed in a screenshot weeks later.
 */
describe("icon registry", () => {
  const entries = Object.entries(icons).flatMap(([group, members]) =>
    Object.entries(members).map(([name, glyph]) => ({ path: `${group}.${name}`, glyph }))
  );

  it("covers every catalog category", () => {
    expect(Object.keys(icons).sort()).toEqual(
      [
        "admin", "ai", "calendar", "chrome", "contacts", "dns", "editor",
        "fileType", "infra", "mailbox", "messageState", "mobile", "search",
        "security", "settings", "status", "threadAction",
      ].sort()
    );
  });

  it("resolves every entry to a real component", () => {
    const broken = entries.filter(({ glyph }) => typeof glyph !== "function" && typeof glyph !== "object");
    expect(broken.map((b) => b.path)).toEqual([]);
  });

  it("defines no entry as undefined", () => {
    // A missing lucide export imports as `undefined` rather than throwing, so
    // this is the check that actually catches a rename.
    expect(entries.filter(({ glyph }) => glyph == null).map((e) => e.path)).toEqual([]);
  });

  it("registers a useful number of concepts", () => {
    expect(entries.length).toBeGreaterThan(200);
  });
});

describe("iconForMimeType", () => {
  it("maps the families by prefix", () => {
    expect(iconForMimeType("image/png")).toBe(fileType.image);
    expect(iconForMimeType("video/mp4")).toBe(fileType.video);
    expect(iconForMimeType("audio/mpeg")).toBe(fileType.audio);
    expect(iconForMimeType("text/plain")).toBe(fileType.text);
  });

  it("maps the exact types that do not share a useful prefix", () => {
    expect(iconForMimeType("application/pdf")).toBe(fileType.pdf);
    expect(iconForMimeType("application/zip")).toBe(fileType.archive);
    expect(iconForMimeType("application/json")).toBe(fileType.code);
    expect(iconForMimeType("text/csv")).toBe(fileType.spreadsheet);
    expect(iconForMimeType("text/calendar")).toBe(calendar.view);
  });

  it("prefers a specific text subtype over the generic text family", () => {
    // Both `text/csv` and `text/html` start with `text/`; neither should fall
    // through to the plain-document icon.
    expect(iconForMimeType("text/csv")).not.toBe(fileType.text);
    expect(iconForMimeType("text/html")).toBe(fileType.code);
  });

  it("ignores parameters and case in the header value", () => {
    expect(iconForMimeType("TEXT/HTML; charset=UTF-8")).toBe(fileType.code);
    expect(iconForMimeType("application/pdf; name=invoice.pdf")).toBe(fileType.pdf);
  });

  it("falls back to the generic icon rather than throwing", () => {
    expect(iconForMimeType("application/x-does-not-exist")).toBe(fileType.generic);
    expect(iconForMimeType("")).toBe(fileType.generic);
  });

  it("is decided by the declared type, never by the filename", () => {
    // An attachment named `invoice.pdf` that is really a zip must look like a
    // zip. The extension is attacker-controlled; the scanned type is not.
    expect(iconForMimeType("application/zip")).toBe(fileType.archive);
  });
});
