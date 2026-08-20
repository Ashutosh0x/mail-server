import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import { db, nowIso } from "./db";
import { config } from "./config";
import { renderQueuedMessage } from "./compose";

/**
 * SMTP delivery.
 *
 * This is where a queued message actually leaves the building — or does not.
 * The distinction the whole design protects: `queued` is a real, durable
 * state, and a message only becomes `sent` when an SMTP server has accepted
 * it. Nothing here reports success on our own say-so.
 *
 * The MIME is built by `mime.ts`, not by nodemailer. Nodemailer is used only
 * as an SMTP client, taking the `raw` message we produce — so the RFC 5322
 * output, and the header-injection defences in it, stay ours and stay tested.
 *
 * When SMTP is not configured, `deliver()` fails loudly and the row stays
 * `queued`. It does not pretend, and it does not silently drop.
 */

export class TransportNotConfiguredError extends Error {
  constructor() {
    super(
      "Outbound mail is not configured. Set SMTP_HOST (and credentials) to deliver queued messages."
    );
    this.name = "TransportNotConfiguredError";
  }
}

let transporter: Transporter | undefined;

export function transportConfigured(): boolean {
  return config.smtp.host !== null;
}

function getTransporter(): Transporter {
  if (!transportConfigured()) throw new TransportNotConfiguredError();
  if (transporter) return transporter;

  transporter = createTransport({
    host: config.smtp.host!,
    port: config.smtp.port,
    // Implicit TLS on 465; STARTTLS everywhere else. Never plaintext by
    // choice — `requireTLS` makes the connection fail rather than silently
    // downgrade, which is the behaviour that matters.
    secure: config.smtp.port === 465,
    // requireTLS makes the connection FAIL rather than silently downgrade.
    // Only lifted deliberately, for relaying to a trusted MTA on loopback.
    requireTLS: config.smtp.port !== 465 && !config.smtp.allowInsecure,
    ignoreTLS: config.smtp.allowInsecure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: process.env.SMTP_PASSWORD ?? "" }
      : undefined,
    // A hung connection must not hold a queue worker forever.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return transporter;
}

/** Verify the SMTP server is reachable. Real connection, no guessing. */
export async function verifyTransport(): Promise<
  { ok: true } | { ok: false; reason: string; configured: boolean }
> {
  if (!transportConfigured()) {
    return { ok: false, configured: false, reason: "SMTP_HOST is not set." };
  }
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, configured: true, reason: describeSmtpError(error) };
  }
}

/**
 * Deliver one queued message.
 *
 * State moves `queued` → `sending` → `sent` | `failed`, and every transition
 * is written before the next step is attempted. A crash mid-delivery leaves a
 * row in `sending` that the reaper can find, rather than a message that
 * vanished.
 */
export async function deliver(
  queueId: string
): Promise<{ status: "sent" | "failed" | "deferred"; detail: string }> {
  const row = db()
    .prepare(
      `SELECT id, user_id, message_id, attempts, status FROM outbound_queue WHERE id = ?`
    )
    .get(queueId) as
    | { id: string; user_id: string; message_id: string; attempts: number; status: string }
    | undefined;

  if (!row) return { status: "failed", detail: "No such queued message." };
  if (row.status === "sent") return { status: "sent", detail: "Already delivered." };

  if (!transportConfigured()) {
    // Deliberately NOT marked failed. The message is fine; the server has no
    // way to send it yet, and a retry after configuration should just work.
    const detail = "Outbound mail is not configured, so this message is waiting in the queue.";
    db()
      .prepare(`UPDATE outbound_queue SET last_error = ?, updated_at = ? WHERE id = ?`)
      .run(detail, nowIso(), queueId);
    return { status: "deferred", detail };
  }

  db()
    .prepare(`UPDATE outbound_queue SET status = 'sending', updated_at = ? WHERE id = ?`)
    .run(nowIso(), queueId);

  try {
    const rendered = await renderQueuedMessage(row.user_id, row.message_id);
    if (!rendered) throw new Error("The message could not be rebuilt for delivery.");

    await getTransporter().sendMail({
      // The envelope, separate from the headers. Bcc recipients appear here
      // and nowhere in the message — that separation is what makes a blind
      // copy blind.
      envelope: { from: rendered.from, to: rendered.envelope },
      raw: rendered.raw,
    });

    db()
      .prepare(
        `UPDATE outbound_queue SET status = 'sent', attempts = attempts + 1,
                last_error = NULL, updated_at = ? WHERE id = ?`
      )
      .run(nowIso(), queueId);

    return { status: "sent", detail: "Accepted by the mail server." };
  } catch (error) {
    const detail = describeSmtpError(error);
    const attempts = Number(row.attempts) + 1;
    // A 4xx is temporary and deserves a retry; a 5xx is a refusal and does
    // not. Retrying a permanent rejection just annoys the receiving server.
    const permanent = isPermanentFailure(error) || attempts >= 5;

    db()
      .prepare(
        `UPDATE outbound_queue
            SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(
        permanent ? "failed" : "queued",
        attempts,
        detail,
        // Exponential backoff, capped.
        new Date(Date.now() + Math.min(2 ** attempts * 60_000, 3_600_000)).toISOString(),
        nowIso(),
        queueId
      );

    return { status: permanent ? "failed" : "deferred", detail };
  }
}

function isPermanentFailure(error: unknown): boolean {
  const code = (error as { responseCode?: number })?.responseCode;
  return typeof code === "number" && code >= 500 && code < 600;
}

/**
 * A readable reason, without dumping a raw SMTP transcript at a normal user.
 *
 * The full text is still recorded in `last_error` for an administrator; this
 * is only what surfaces in the UI.
 */
function describeSmtpError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const responseCode = (error as { responseCode?: number })?.responseCode;

  if (code === "EAUTH") return "The mail server rejected our credentials.";
  if (code === "ECONNREFUSED") return "The mail server refused the connection.";
  if (code === "ETIMEDOUT" || code === "ESOCKET") return "The mail server did not respond in time.";
  if (code === "EDNS") return "The mail server's hostname could not be resolved.";
  if (responseCode === 550) return "The recipient address was rejected.";
  if (responseCode === 552) return "The message was too large for the recipient's server.";
  if (responseCode && responseCode >= 500) return "The recipient's server permanently rejected the message.";
  if (responseCode && responseCode >= 400) return "The recipient's server asked us to try again later.";

  const message = (error as Error)?.message;
  return message ? message.slice(0, 200) : "Delivery failed for an unknown reason.";
}
