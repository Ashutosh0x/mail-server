import "server-only";
import { db, newId, nowIso, transaction } from "./db";
import { hashPassword } from "./auth";
import { provisionMailboxes } from "./mail";
import { config } from "./config";

/**
 * Account creation.
 *
 * A new account gets a tenant, a domain and six empty system mailboxes — and
 * nothing else. No welcome message, no sample contacts, no demo labels. An
 * empty inbox is the true state of a new account, and the UI says so.
 */

export class RegistrationError extends Error {
  constructor(message: string, readonly code: "email_taken" | "invalid_domain") {
    super(message);
    this.name = "RegistrationError";
  }
}

export function emailExists(email: string): boolean {
  const row = db().prepare(`SELECT 1 AS x FROM users WHERE email = ?`).get(email.toLowerCase());
  return row !== undefined;
}

export function createAccount(input: {
  email: string;
  password: string;
  displayName: string;
}): { userId: string } {
  const email = input.email.toLowerCase();
  const domainName = email.split("@")[1];
  if (!domainName) throw new RegistrationError("That address has no domain.", "invalid_domain");

  return transaction(() => {
    // Checked inside the transaction: two simultaneous registrations for the
    // same address would both pass a check made outside it.
    if (emailExists(email)) {
      throw new RegistrationError("An account with that address already exists.", "email_taken");
    }

    // One tenant per self-registered user. A hosted deployment would attach the
    // user to an existing tenant instead; the schema already allows both.
    const tenantId = newId();
    db()
      .prepare(
        `INSERT INTO tenants (id, name, slug, plan, status, max_storage_mb, created_at, updated_at)
         VALUES (?, ?, ?, 'free', 'active', ?, ?, ?)`
      )
      .run(tenantId, domainName, `${domainName}-${tenantId.slice(0, 8)}`,
           Math.floor(config.maxUserStorageBytes / (1024 * 1024)), nowIso(), nowIso());

    let domainId: string;
    const existingDomain = db()
      .prepare(`SELECT id FROM domains WHERE name = ?`)
      .get(domainName) as { id: string } | undefined;

    if (existingDomain) {
      domainId = existingDomain.id;
    } else {
      domainId = newId();
      db()
        .prepare(
          `INSERT INTO domains (id, tenant_id, name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?)`
        )
        .run(domainId, tenantId, domainName, nowIso(), nowIso());
    }

    const userId = newId();
    db()
      .prepare(
        `INSERT INTO users
           (id, tenant_id, domain_id, email, display_name, password_hash, role, status,
            quota_bytes, used_bytes, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'active', ?, 0, 0, ?, ?)`
      )
      .run(userId, tenantId, domainId, email, input.displayName, hashPassword(input.password),
           config.maxUserStorageBytes, nowIso(), nowIso());

    provisionMailboxes(userId);
    return { userId };
  });
}

export function findByEmail(email: string) {
  return db()
    .prepare(`SELECT id, email, password_hash, status FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as
    | { id: string; email: string; password_hash: string | null; status: string }
    | undefined;
}
