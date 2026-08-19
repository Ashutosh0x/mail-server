import { describe, expect, it } from "vitest";
import { loadMigrations, planMigrations } from "./migrate.mjs";

describe("migration planner", () => {
  const files = [
    { filename: "0001_a.sql", sql: "SELECT 1", checksum: "aaa" },
    { filename: "0002_b.sql", sql: "SELECT 2", checksum: "bbb" },
  ];

  it("plans every file on a fresh database", async () => {
    const { pending, drifted } = await planMigrations(files, []);
    expect(pending.map((f) => f.filename)).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(drifted).toEqual([]);
  });

  it("is a no-op when everything is applied — running twice must be safe", async () => {
    const applied = files.map((f) => ({ filename: f.filename, checksum: f.checksum }));
    const { pending } = await planMigrations(files, applied);
    expect(pending).toEqual([]);
  });

  it("applies only what is new", async () => {
    const { pending } = await planMigrations(files, [{ filename: "0001_a.sql", checksum: "aaa" }]);
    expect(pending.map((f) => f.filename)).toEqual(["0002_b.sql"]);
  });

  it("reports drift when an applied migration was edited", async () => {
    // The database ran one thing; the file now says another. Silently
    // re-applying or silently skipping are both wrong.
    const { drifted, pending } = await planMigrations(files, [
      { filename: "0001_a.sql", checksum: "DIFFERENT" },
    ]);
    expect(drifted).toEqual(["0001_a.sql"]);
    expect(pending.map((f) => f.filename)).toEqual(["0002_b.sql"]);
  });
});

describe("migrations on disk", () => {
  it("loads, checksums, and orders them by filename", async () => {
    const found = await loadMigrations();
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((f) => f.filename)).toEqual([...found.map((f) => f.filename)].sort());
    for (const file of found) expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("wraps each migration in an explicit transaction", async () => {
    for (const file of await loadMigrations()) {
      expect(file.sql).toContain("BEGIN;");
      expect(file.sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    }
  });
});
