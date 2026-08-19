"use client";

import type { Thread } from "@mailserver/types";
import { Icon, cn, iconForMimeType, icons } from "@mailserver/ui";
import { formatBytes, initialsOf, senderLabel } from "@/lib/format";
import { AuthenticationChips, PhishingBanner } from "./verdict-badge";

const ACTIONS = [
  { key: "reply", icon: icons.threadAction.reply, label: "Reply", shortcut: "R" },
  { key: "replyAll", icon: icons.threadAction.replyAll, label: "Reply all", shortcut: "A" },
  { key: "forward", icon: icons.threadAction.forward, label: "Forward", shortcut: "F" },
  { key: "archive", icon: icons.threadAction.archive, label: "Archive", shortcut: "E" },
  { key: "snooze", icon: icons.threadAction.snooze, label: "Snooze", shortcut: "H" },
  { key: "delete", icon: icons.threadAction.delete, label: "Delete", shortcut: "#" },
] as const;

export function ReadingPane({ thread }: { thread: Thread | null }) {
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
  const sender = senderLabel(latest.from);

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
              className="rounded-md p-2 text-ink-secondary transition-colors duration-[--duration-fast] hover:bg-surface-sunken hover:text-ink"
            >
              <Icon icon={action.icon} size="md" label={action.label} />
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <PhishingBanner auth={latest.authentication} verdict={latest.verdict} />

        <article className="mt-3 rounded-xl border border-border bg-surface-raised">
          <div className="flex items-start gap-3 border-b border-border-muted p-4">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-muted text-sm font-medium text-primary"
            >
              {initialsOf(sender)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-ink">{sender}</span>
                <span className="text-sm text-ink-muted">&lt;{latest.from[0]?.email}&gt;</span>
              </div>
              <p className="text-sm text-ink-muted">
                to {latest.to.map((a) => a.name ?? a.email).join(", ") || "undisclosed recipients"}
              </p>
              <div className="mt-2">
                <AuthenticationChips auth={latest.authentication} />
              </div>
            </div>
            <time dateTime={latest.receivedAt} className="shrink-0 text-sm text-ink-muted">
              {new Date(latest.receivedAt).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </time>
          </div>

          {/*
            The body is a placeholder rather than rendered HTML, deliberately.
            Section 16 requires DOMPurify sanitisation, remote-image blocking,
            tracker stripping and a sandboxed iframe before any untrusted HTML
            reaches the DOM. That pipeline is not built yet, so this shows the
            server's plain-text preview instead of pretending to be safe.
          */}
          <div className="p-4">
            <p className="whitespace-pre-wrap text-base leading-relaxed text-ink-secondary">{latest.preview}</p>
            <p className="mt-4 flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              <Icon icon={icons.security.trackerBlocked} size="sm" />
              HTML rendering is disabled until the sanitisation pipeline ships.
            </p>
          </div>

          {latest.attachments.length > 0 && (
            <div className="border-t border-border-muted p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {latest.attachments.length} attachment{latest.attachments.length === 1 ? "" : "s"}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {latest.attachments.map((file) => (
                  <li
                    key={file.blobId}
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <Icon icon={iconForMimeType(file.type)} size="md" className="text-attachment" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{file.name ?? "(unnamed)"}</span>
                      <span className="block text-xs text-ink-muted">{formatBytes(file.size)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className={cn("rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-secondary")}>
      {children}
    </kbd>
  );
}
