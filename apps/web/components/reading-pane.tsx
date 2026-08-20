"use client";

import { useState } from "react";
import type { EmailHeader, Thread } from "@mailserver/types";
import { Icon, cn, iconForMimeType, icons } from "@mailserver/ui";
import { formatBytes, initialsOf, senderLabel } from "@/lib/format";
import { AuthenticationChips, PhishingBanner } from "./verdict-badge";

/**
 * Every action here does something. Snooze used to sit in this row and was
 * removed rather than left in place: there is no scheduler behind it, and a
 * button that silently does nothing is worse than an absent one.
 */
const ACTIONS = [
  { key: "reply", icon: icons.threadAction.reply, label: "Reply", shortcut: "R" },
  { key: "replyAll", icon: icons.threadAction.replyAll, label: "Reply all", shortcut: "A" },
  { key: "forward", icon: icons.threadAction.forward, label: "Forward", shortcut: "F" },
  { key: "archive", icon: icons.threadAction.archive, label: "Archive", shortcut: "E" },
  { key: "delete", icon: icons.threadAction.delete, label: "Delete", shortcut: "#" },
] as const;

export type ThreadAction = (typeof ACTIONS)[number]["key"];

export function ReadingPane({
  thread,
  emails,
  loadingThread,
  onAction,
  busy,
}: {
  thread: Thread | null;
  /** Every message in the conversation. Null until the fetch resolves. */
  emails?: EmailHeader[] | null;
  loadingThread?: boolean;
  onAction?: (action: ThreadAction) => void;
  /** True while an action is in flight, so it cannot be fired twice. */
  busy?: boolean;
}) {
  if (!thread) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
        <Icon icon={icons.mailbox.inbox} size="hero" className="text-ink-disabled" />
        <p className="text-lg font-medium text-ink-secondary">No conversation selected</p>
        <p className="max-w-xs text-sm text-ink-muted">
          Pick a message from the list, or press <Kbd>J</Kbd> and <Kbd>K</Kbd> to move through it.
        </p>
      </section>
    );
  }

  const { latest } = thread;
  // The newest message alone until the full thread arrives, so opening a
  // conversation shows something immediately rather than an empty pane.
  const messages = emails && emails.length > 0 ? emails : [latest];

  return (
    <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex items-start gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-ink">{latest.subject}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              title={`${action.label} (${action.shortcut})`}
              disabled={busy}
              onClick={() => onAction?.(action.key)}
              className="rounded-md p-2 text-ink-secondary transition-colors duration-[--duration-fast] hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon icon={action.icon} size="md" label={action.label} />
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <PhishingBanner auth={latest.authentication} verdict={latest.verdict} />

        {/*
          Every message in the conversation, oldest first — the order a thread
          is read in. Until now this rendered only the newest while the header
          counted them all, so a five-message thread showed one message and
          said "5 messages".

          `messages` falls back to the newest alone while the full thread is
          still loading, so the pane never renders empty.
        */}
        <ol className="mt-3 space-y-3">
          {messages.map((message, index) => (
            <li key={message.id}>
              <MessageCard
                message={message}
                // The newest is what someone opened the thread to read.
                defaultOpen={index === messages.length - 1}
              />
            </li>
          ))}
        </ol>

        {loadingThread && (
          <p className="mt-3 text-sm text-ink-muted" role="status">
            Loading the rest of this conversation…
          </p>
        )}
      </div>
    </section>
  );
}


/**
 * One message in a conversation.
 *
 * Collapsed by default except the newest: a long thread is unreadable when
 * every message is expanded at once, and the one worth reading is almost
 * always the last.
 */
function MessageCard({ message, defaultOpen }: { message: EmailHeader; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const sender = senderLabel(message.from);
  const when = new Date(message.receivedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="rounded-xl border border-border bg-surface-raised">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-muted text-sm font-medium text-primary"
        >
          {initialsOf(sender)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-ink">{sender}</span>
            <span className="text-sm text-ink-muted">&lt;{message.from[0]?.email}&gt;</span>
          </span>
          {open ? (
            <span className="block text-sm text-ink-muted">
              to {message.to.map((a) => a.name ?? a.email).join(", ") || "undisclosed recipients"}
              {message.cc.length > 0 &&
                `, cc ${message.cc.map((a) => a.name ?? a.email).join(", ")}`}
            </span>
          ) : (
            // Collapsed rows carry the preview, so a thread can be skimmed.
            <span className="block truncate text-sm text-ink-muted">{message.preview}</span>
          )}
        </span>
        <time dateTime={message.receivedAt} className="shrink-0 text-sm text-ink-muted">
          {when}
        </time>
      </button>

      {open && (
        <>
          <div className="border-t border-border-muted px-4 py-3">
            <AuthenticationChips auth={message.authentication} />
          </div>

          {/*
            The body is the server's plain-text preview, deliberately, not
            rendered HTML.

            Sanitisation itself DOES exist — lib/server/sanitize.ts, allow-list
            based and covered by 22 tests — and every outgoing body passes
            through it. What is still missing is the rest of the read path:
            remote-image blocking, tracker stripping, and a sandboxed frame to
            render in. Sanitised HTML injected straight into this document
            would still leak a read receipt to every remote image on load, so
            the preview stays until those three exist.
          */}
          <div className="p-4">
            <p className="whitespace-pre-wrap text-base leading-relaxed text-ink-secondary">
              {message.preview}
            </p>
            <p className="mt-4 flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              <Icon icon={icons.security.trackerBlocked} size="sm" />
              HTML rendering is disabled until the sanitisation pipeline ships.
            </p>
          </div>

          {message.attachments.length > 0 && (
            <div className="border-t border-border-muted p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {message.attachments.map((file) => (
                  <li key={file.blobId}>
                    {/*
                      A real download from the authenticated endpoint, which
                      checks ownership and streams from storage. `download`
                      asks the browser to save rather than navigate, so an
                      HTML attachment cannot execute on this origin.
                    */}
                    <a
                      href={`/api/attachments/${encodeURIComponent(file.blobId)}`}
                      download={file.name ?? undefined}
                      className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 hover:border-primary hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <Icon icon={iconForMimeType(file.type)} size="md" className="text-attachment" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {file.name ?? "(unnamed)"}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {formatBytes(file.size)} · Download
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className={cn("rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-secondary")}>
      {children}
    </kbd>
  );
}
