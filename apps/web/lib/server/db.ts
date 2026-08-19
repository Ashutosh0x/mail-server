import "server-only";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config";

/**
 * The local database connection.
 *
 * SQLite via `node:sqlite` — built into Node 22, so there is no native module
 * to compile and the app runs with nothing else installed. PostgreSQL remains
 * the production target (packages/database/migrations); the schemas are held in
 * step by a parity test.
 *
 * One connection, cached on `globalThis` so Next's dev hot-reload does not open
 * a new handle on every edit and eventually exhaust them.
 */

const SCHEMA_PATH = join(process.cwd(), "..", "..", "packages", "database", "sqlite", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __mailserverDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  const file = join(process.cwd(), config.databaseFile);
  mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // Enforced per connection, not per database: without this, ON DELETE CASCADE
  // is silently ignored and orphaned rows accumulate.
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  // A writer waits rather than failing instantly when another request holds the
  // lock. Five seconds is far longer than any statement here should take.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

export function db(): DatabaseSync {
  if (!globalThis.__mailserverDb) globalThis.__mailserverDb = open();
  return globalThis.__mailserverDb;
}

/** RFC 3339 UTC — sorts lexicographically, which is why every timestamp is one. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

/**
 * Run `work` in a transaction, rolling back if it throws.
 *
 * Sending a message writes to `messages`, `message_recipients`, `attachments`,
 * `threads` and `outbound_queue`. Committing some of those is worse than
 * committing none: a thread with no message, or an attachment row pointing at
 * bytes that were never stored.
 */
export function transaction<T>(work: () => T): T {
  const handle = db();
  handle.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}
