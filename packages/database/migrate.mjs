#!/usr/bin/env node
/**
 * Migration runner.
 *
 * Replaces `psql -f 001_initial_schema.sql $DATABASE_URL`, which had three
 * problems: it failed on the second run, it kept no record of what had been
 * applied, and an edit to an already-applied file was undetectable.
 *
 * Rules:
 *   1. Every file is applied inside ONE transaction. A migration that fails
 *      half way leaves the schema exactly as it was.
 *   2. Every applied file is recorded with the SHA-256 of its contents.
 *   3. If a recorded file's checksum no longer matches, the run ABORTS. Editing
 *      an applied migration means production and this file disagree, and the
 *      only safe response is to stop and let a human write a new migration.
 *
 * `--dry-run` prints the plan and touches nothing.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

const LEDGER = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL
)`;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export async function planMigrations(files, applied) {
  const byName = new Map(applied.map((row) => [row.filename, row.checksum]));
  const pending = [];
  const drifted = [];

  for (const file of files) {
    const recorded = byName.get(file.filename);
    if (recorded === undefined) pending.push(file);
    else if (recorded !== file.checksum) drifted.push(file.filename);
  }
  return { pending, drifted };
}

export async function loadMigrations(dir = MIGRATIONS_DIR) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (filename) => {
      const sql = await readFile(join(dir, filename), "utf8");
      return { filename, sql, checksum: sha256(sql) };
    })
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL;
  const files = await loadMigrations();

  if (files.length === 0) {
    console.error("No .sql files in", MIGRATIONS_DIR);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`${files.length} migration(s) on disk:`);
    for (const f of files) console.log(`  ${f.filename}  ${f.checksum.slice(0, 12)}`);
    console.log("\n--dry-run: nothing applied.");
    return;
  }

  if (!url) {
    console.error("DATABASE_URL is not set. Refusing to guess a connection string.");
    process.exit(1);
  }

  // `pg` is imported lazily so --dry-run works without the dependency, which
  // is what makes this runnable in an environment with no database at all.
  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.error("The 'pg' package is required to apply migrations. Install it in packages/database.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(LEDGER);
    const { rows: applied } = await client.query("SELECT filename, checksum FROM schema_migrations");
    const { pending, drifted } = await planMigrations(files, applied);

    if (drifted.length > 0) {
      console.error("Applied migrations have been modified on disk:");
      for (const name of drifted) console.error(`  ${name}`);
      console.error("\nThe database and these files no longer agree. Write a NEW migration instead.");
      process.exit(1);
    }

    if (pending.length === 0) {
      console.log(`Up to date — ${applied.length} migration(s) already applied.`);
      return;
    }

    for (const file of pending) {
      const started = Date.now();
      console.log(`applying ${file.filename} …`);
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3)",
          [file.filename, file.checksum, Date.now() - started]
        );
        await client.query("COMMIT");
        console.log(`  ok (${Date.now() - started}ms)`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  FAILED — rolled back: ${error.message}`);
        process.exit(1);
      }
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

// Only run when invoked directly, so the planner can be unit-tested.
//
// `pathToFileURL` rather than string-building the URL: on Windows a drive path
// becomes file:///C:/… with three slashes, so the hand-rolled comparison never
// matched and the script silently did nothing at all.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
