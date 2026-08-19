"use client";

import type { Label, Mailbox, MailboxRole } from "@mailserver/types";
import { Icon, cn, icons, type LucideIcon } from "@mailserver/ui";

/**
 * System folders are keyed off JMAP `role`, never off `name`.
 *
 * A server may call the inbox "Posteingang". Matching on the display name would
 * quietly drop the icon and the ordering for every non-English deployment, and
 * the bug would only ever be reported by users we cannot read.
 */
const ROLE_ICON: Partial<Record<NonNullable<MailboxRole>, LucideIcon>> = {
  inbox: icons.mailbox.inbox,
  sent: icons.mailbox.sent,
  drafts: icons.mailbox.drafts,
  archive: icons.mailbox.archive,
  junk: icons.mailbox.spam,
  trash: icons.mailbox.trash,
  important: icons.mailbox.important,
};

const LABEL_SWATCH: Record<Label["color"], string> = {
  red: "bg-label-red-ink", orange: "bg-label-orange-ink", yellow: "bg-label-yellow-ink",
  green: "bg-label-green-ink", teal: "bg-label-teal-ink", blue: "bg-label-blue-ink",
  indigo: "bg-label-indigo-ink", purple: "bg-label-purple-ink", pink: "bg-label-pink-ink",
  gray: "bg-label-gray-ink", brown: "bg-label-brown-ink", cyan: "bg-label-cyan-ink",
};

export function Sidebar({
  mailboxes,
  labels,
  activeMailboxId,
  collapsed,
  onSelect,
  onCompose,
}: {
  mailboxes: Mailbox[];
  labels: Label[];
  activeMailboxId: string;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onCompose: () => void;
}) {
  return (
    <nav
      aria-label="Mailboxes"
      className={cn(
        "flex shrink-0 flex-col gap-4 border-r border-border bg-surface py-3 transition-[width] duration-[--duration-base]",
        collapsed ? "w-14 px-2" : "w-56 px-3"
      )}
    >
      <button
        type="button"
        onClick={onCompose}
        className={cn(
          "flex items-center gap-2 rounded-lg bg-primary px-3 py-2 font-medium text-primary-ink",
          "transition-colors duration-[--duration-fast] hover:bg-primary-hover active:bg-primary-active",
          collapsed && "justify-center px-0"
        )}
      >
        <Icon icon={icons.messageState.compose} size="md" label={collapsed ? "Compose" : undefined} />
        {!collapsed && <span className="text-sm">Compose</span>}
      </button>

      <ul className="flex flex-col gap-0.5">
        {mailboxes.map((mailbox) => {
          const glyph = (mailbox.role && ROLE_ICON[mailbox.role]) ?? icons.mailbox.folder;
          const active = mailbox.id === activeMailboxId;
          return (
            <li key={mailbox.id}>
              <button
                type="button"
                onClick={() => onSelect(mailbox.id)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? mailbox.name : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                  "transition-colors duration-[--duration-fast]",
                  active ? "bg-primary-muted font-semibold text-primary" : "text-ink-secondary hover:bg-surface-sunken",
                  collapsed && "justify-center px-0"
                )}
              >
                <Icon icon={glyph} size="md" label={collapsed ? mailbox.name : undefined} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{mailbox.name}</span>
                    {mailbox.unreadEmails > 0 && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums">{mailbox.unreadEmails}</span>
                    )}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!collapsed && labels.length > 0 && (
        <div>
          <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Labels</h2>
          <ul className="flex flex-col gap-0.5">
            {labels.map((label) => (
              <li key={label.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink-secondary transition-colors duration-[--duration-fast] hover:bg-surface-sunken"
                >
                  <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", LABEL_SWATCH[label.color])} />
                  <span className="flex-1 truncate text-left">{label.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
