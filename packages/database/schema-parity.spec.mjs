import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The PostgreSQL migrations and the SQLite development schema describe the same
 * system. This test is what stops them drifting apart silently — a table added
 * to one and forgotten in the other means a feature that works locally and
 * 500s in production, discovered in production.
 *
 * Only the TABLE SET is compared. Column-level parity would need a real SQL
 * parser, and the dialects legitimately differ on types (UUID vs TEXT, JSONB vs
 * TEXT, partitioning vs none). Treat the Postgres migration as authoritative
 * when the two disagree about anything finer than "does this table exist".
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Tables that exist in exactly one dialect, with the reason. */
const POSTGRES_ONLY = new Set([
  // Declarative partitions are real tables in Postgres. SQLite has no
  // partitioning, so the parent table alone carries the rows.
  "delivery_events_default",
  "audit_logs_default",
]);

const SQLITE_ONLY = new Set([
  // FTS5 virtual table. Postgres uses tsvector/GIN on `messages` instead, so
  // there is no separate table to match.
  "messages_fts",
  // Local outbound spool. In production this is a queue (NATS/Postgres
  // SKIP LOCKED) owned by the delivery service, not a table in this schema.
  "outbound_queue",
]);

function tablesIn(sql) {
  const found = new Set();
  const pattern = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const match of sql.matchAll(pattern)) found.add(match[1].toLowerCase());
  return found;
}

async function postgresTables() {
  const dir = join(HERE, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const all = new Set();
  for (const file of files) {
    for (const table of tablesIn(await readFile(join(dir, file), "utf8"))) all.add(table);
  }
  return all;
}

async function sqliteTables() {
  return tablesIn(await readFile(join(HERE, "sqlite", "schema.sql"), "utf8"));
}

describe("schema parity", () => {
  it("defines tables in both dialects", async () => {
    expect((await postgresTables()).size).toBeGreaterThan(10);
    expect((await sqliteTables()).size).toBeGreaterThan(10);
  });

  it("has no Postgres table missing from SQLite", async () => {
    const sqlite = await sqliteTables();
    const gaps = [...(await postgresTables())]
      .filter((table) => !POSTGRES_ONLY.has(table))
      .filter((table) => !sqlite.has(table));
    expect(gaps, `add these to sqlite/schema.sql, or list them in POSTGRES_ONLY: ${gaps.join(", ")}`).toEqual([]);
  });

  it("has no SQLite table missing from Postgres", async () => {
    const postgres = await postgresTables();
    const gaps = [...(await sqliteTables())]
      .filter((table) => !SQLITE_ONLY.has(table))
      .filter((table) => !postgres.has(table));
    expect(gaps, `add these to migrations/, or list them in SQLITE_ONLY: ${gaps.join(", ")}`).toEqual([]);
  });

  it("keeps the deliberate exceptions honest", async () => {
    // An exception that no longer applies is a lie in the allowlist. If a
    // Postgres-only table has since been added to SQLite, the entry must go.
    const sqlite = await sqliteTables();
    const stale = [...POSTGRES_ONLY].filter((table) => sqlite.has(table));
    expect(stale, `remove from POSTGRES_ONLY — now present in SQLite: ${stale.join(", ")}`).toEqual([]);

    const postgres = await postgresTables();
    const staleSqlite = [...SQLITE_ONLY].filter((table) => postgres.has(table));
    expect(staleSqlite, `remove from SQLITE_ONLY — now present in Postgres: ${staleSqlite.join(", ")}`).toEqual([]);
  });
});
