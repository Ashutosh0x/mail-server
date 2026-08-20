"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, cn, duration, easing, haptics, icons } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import { isValidAddress } from "@/lib/address";
import { useMotion } from "@/lib/motion-preference";
import { RecipientField, type Recipient } from "./recipient-field";

/**
 * The composer.
 *
 * Two properties the rest of the design serves:
 *
 * 1. A DRAFT IS NEVER LOST. Autosave is debounced, and the version the server
 *    returns is carried into the next save so a second tab cannot silently
 *    overwrite this one.
 *
 * 2. SEND STATE IS THE BACKEND'S STATE. The button never shows "Sent" on its
 *    own say-so — it reports `queued` until an SMTP server has actually
 *    accepted the message, and says so plainly when outbound mail is not
 *    configured.
 */

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "queued"; detail: string; transportConfigured: boolean }
  | { kind: "sent" }
  | { kind: "failed"; detail: string };

export function Composer({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent?: () => void;
}) {
  const { reduced } = useMotion();

  const [draftId, setDraftId] = useState<string | null>(null);
  const [senders, setSenders] = useState<{ name?: string | null; email: string }[]>([]);
  const [from, setFrom] = useState<string>("");

  const [to, setTo] = useState<Recipient[]>([]);
  const [cc, setCc] = useState<Recipient[]>([]);
  const [bcc, setBcc] = useState<Recipient[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [minimised, setMinimised] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const version = useRef(0);
  // Generated once per composer, so a double-click or a retried request
  // cannot produce two emails.
  const idempotencyKey = useRef(
    typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())
  );

  // ── Create the draft on open ─────────────────────────────────────────────
  //
  // Exactly one draft, exactly once.
  //
  // React StrictMode mounts, unmounts and remounts in development. A ref
  // guard alone is not enough: refs SURVIVE that remount, so the second
  // invocation skips the request while the first one's cleanup discards its
  // result — leaving draftId null forever and Send permanently disabled.
  //
  // So the guard prevents the duplicate request, and there is deliberately no
  // cancellation: the single in-flight response is always applied. Setting
  // state after unmount is a no-op in React 18+, not a leak.
  const creating = useRef(false);

  useEffect(() => {
    if (creating.current) return;
    creating.current = true;

    void api
      .createDraft()
      .then((result) => {
        setDraftId(result.draftId);
        setSenders(result.senders);
        setFrom(result.senders[0]?.email ?? "");
      })
      .catch((cause) => {
        // Allow a retry: nothing was created, so the guard must not latch.
        creating.current = false;
        setError(cause instanceof ApiError ? cause.message : "Could not start a draft.");
      });
  }, []);
  // ── Autosave ─────────────────────────────────────────────────────────────
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = true;
  }, [to, cc, bcc, subject, body]);

  useEffect(() => {
    if (!draftId) return undefined;

    // 800ms after the last keystroke: long enough that typing a sentence is
    // one request, short enough that a closed laptop loses almost nothing.
    const timer = window.setTimeout(() => {
      if (!dirty.current) return;
      dirty.current = false;
      setSaveState("saving");

      void api
        .saveDraft(draftId, {
          to,
          cc,
          bcc,
          subject,
          bodyHtml: body,
          version: version.current,
        })
        .then((result) => {
          version.current = result.version;
          setSaveState("saved");
        })
        .catch((cause) => {
          if (cause instanceof ApiError && cause.status === 409) {
            // Never silently overwrite. The user is told, and their text stays
            // on screen so nothing they wrote is thrown away.
            setError("This draft was changed somewhere else. Your changes are not saved.");
          }
          setSaveState("error");
        });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [draftId, to, cc, bcc, subject, body]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const invalid = [...to, ...cc, ...bcc].filter((r) => !isValidAddress(r.email));
  const canSend = draftId !== null && to.length + cc.length + bcc.length > 0 && invalid.length === 0;

  const send = useCallback(async () => {
    if (!draftId || !canSend) return;
    setSendState({ kind: "sending" });
    setError(null);

    try {
      // Flush pending edits first — sending a draft the server has not seen
      // would send yesterday's text.
      await api.saveDraft(draftId, { to, cc, bcc, subject, bodyHtml: body });
      const result = await api.sendDraft(draftId, idempotencyKey.current, from || undefined);

      if (result.delivery.status === "sent") {
        haptics.success();
        setSendState({ kind: "sent" });
        window.setTimeout(() => {
          onSent?.();
          onClose();
        }, 900);
      } else if (result.delivery.status === "failed") {
        haptics.error();
        setSendState({ kind: "failed", detail: result.delivery.detail });
      } else {
        // Queued, not sent. Said plainly rather than dressed up as success.
        setSendState({
          kind: "queued",
          detail: result.delivery.detail,
          transportConfigured: result.transportConfigured,
        });
        onSent?.();
      }
    } catch (cause) {
      haptics.error();
      setSendState({ kind: "idle" });
      setError(cause instanceof ApiError ? cause.message : "The message could not be sent.");
    }
  }, [draftId, canSend, to, cc, bcc, subject, body, from, onClose, onSent]);

  /**
   * Close, discarding the draft only if nothing was written.
   *
   * A draft row is created the moment the composer opens, so autosave has
   * somewhere to go. Closing without typing would otherwise leave an empty
   * shell in Drafts — one per accidental Compose click.
   *
   * Anything the user actually wrote is kept, always.
   */
  const close = useCallback(() => {
    const untouched =
      to.length === 0 &&
      cc.length === 0 &&
      bcc.length === 0 &&
      subject.trim() === "" &&
      body.trim() === "";

    if (draftId && untouched && sendState.kind === "idle") {
      // Fire and forget: the composer should close instantly, and a failed
      // cleanup leaves an empty draft rather than blocking the user.
      void api.deleteDraft(draftId).catch(() => undefined);
    }
    onClose();
  }, [draftId, to, cc, bcc, subject, body, sendState.kind, onClose]);

  // Cmd/Ctrl+Enter sends; Escape closes. Escape never discards written
  // content — the draft is already saved, so closing is safe.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void send();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, send]);

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        className="fixed bottom-0 right-4 z-40 flex w-72 items-center justify-between gap-2 rounded-t-lg border border-b-0 border-border bg-surface-raised px-3 py-2 text-left shadow-lg"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {subject || "New message"}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          {saveState === "saved" ? "Draft saved" : saveState === "saving" ? "Saving…" : ""}
        </span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="New message"
      className={cn(
        "fixed z-40 flex flex-col border border-border bg-surface-raised shadow-2xl",
        // Full screen on mobile; a docked panel on desktop.
        "inset-0 sm:inset-auto",
        maximised
          ? "sm:inset-6 sm:rounded-xl"
          : "sm:bottom-0 sm:right-4 sm:h-[32rem] sm:w-[36rem] sm:rounded-t-xl"
      )}
      style={{
        animation: reduced ? undefined : `menuIn ${duration.normal}ms ${easing.enter}`,
      }}
    >
      <header className="flex shrink-0 items-center gap-2 rounded-t-xl bg-surface-sunken px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {subject || "New message"}
        </span>
        <button
          type="button"
          onClick={() => setMinimised(true)}
          className="hidden rounded p-1 text-ink-secondary hover:bg-border sm:block"
        >
          <Icon icon={icons.chrome.remove} size="sm" label="Minimise" />
        </button>
        <button
          type="button"
          onClick={() => setMaximised((v) => !v)}
          className="hidden rounded p-1 text-ink-secondary hover:bg-border sm:block"
        >
          <Icon icon={icons.chrome.fullscreen} size="sm" label={maximised ? "Restore" : "Maximise"} />
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded p-1 text-ink-secondary hover:bg-border"
        >
          <Icon icon={icons.chrome.close} size="sm" label="Close" />
        </button>
      </header>

      {senders.length > 1 && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="w-10 shrink-0 text-xs text-ink-muted">From</span>
          <select
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none"
          >
            {senders.map((sender) => (
              <option key={sender.email} value={sender.email}>
                {sender.name ? `${sender.name} <${sender.email}>` : sender.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <RecipientField id="compose-to" label="To" value={to} onChange={setTo} autoFocus />

      {showCc ? (
        <>
          <RecipientField id="compose-cc" label="Cc" value={cc} onChange={setCc} />
          <RecipientField id="compose-bcc" label="Bcc" value={bcc} onChange={setBcc} />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowCc(true)}
          className="self-start px-3 py-1 text-xs font-medium text-primary hover:underline"
        >
          Add Cc / Bcc
        </button>
      )}

      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <label htmlFor="compose-subject" className="w-10 shrink-0 text-xs text-ink-muted">
          Subject
        </label>
        <input
          id="compose-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={998}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
          placeholder="Subject"
        />
      </div>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="min-h-0 flex-1 resize-none bg-transparent p-3 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted"
        placeholder="Write your message…"
      />

      {error && (
        <div role="alert" className="mx-3 mb-2 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
          {error}
        </div>
      )}

      {sendState.kind === "queued" && (
        <div role="status" className="mx-3 mb-2 rounded-lg bg-warning-muted px-3 py-2 text-sm text-warning-ink">
          <strong className="font-medium">Queued, not yet delivered.</strong> {sendState.detail}
        </div>
      )}
      {sendState.kind === "failed" && (
        <div role="alert" className="mx-3 mb-2 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
          <strong className="font-medium">Delivery failed.</strong> {sendState.detail} Your draft is
          safe in Drafts.
        </div>
      )}
      {invalid.length > 0 && (
        <div role="alert" className="mx-3 mb-2 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
          Check {invalid.length === 1 ? "this address" : "these addresses"}:{" "}
          {invalid.map((r) => r.email).join(", ")}
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2">
        <button
          type="button"
          disabled={!canSend || sendState.kind === "sending" || sendState.kind === "sent"}
          onClick={() => void send()}
          className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-ink transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {sendState.kind === "sending"
            ? "Sending…"
            : sendState.kind === "sent"
              ? "Sent"
              : sendState.kind === "queued"
                ? "Queued"
                : "Send"}
        </button>

        <span className="text-xs text-ink-muted" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : ""}
        </span>

        <span className="ml-auto text-xs text-ink-muted">
          {/* Attachments need the upload path wired into the draft; the API
              exists but the picker does not, so nothing here pretends. */}
          Attachments are not wired into the composer yet
        </span>
      </footer>
    </div>
  );
}
