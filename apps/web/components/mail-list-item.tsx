"use client";

import type { Thread } from "@mailserver/types";
import { useState } from "react";
import { Icon, cn, haptics, icons } from "@mailserver/ui";
import { useMotion } from "@/lib/motion-preference";
import { formatListTimestamp, initialsOf, senderLabel } from "@/lib/format";
import { VerdictBadge } from "./verdict-badge";

export type Density = "compact" | "comfortable" | "spacious";

export const ROW_HEIGHT: Record<Density, number> = {
  compact: 36,
  comfortable: 56,
  spacious: 76,
};

/**
 * One row of the mail list, at one of three densities (Section 8).
 *
 * Density changes what is *shown*, not just what is spaced: compact drops the
 * avatar and folds the snippet onto the sender line, spacious promotes the
 * snippet to two lines and surfaces attachment names. Rendering all three from
 * one markup tree and hiding parts with CSS would keep hidden nodes in the
 * accessibility tree and in the virtualiser's height maths.
 */
export function MailListItem({
  thread,
  density,
  selected,
  active,
  onOpen,
  onToggleSelect,
  onToggleStar,
}: {
  thread: Thread;
  density: Density;
  selected: boolean;
  active: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onToggleStar: () => void;
}) {
  const [pulse, setPulse] = useState(false);
  const { reduced } = useMotion();
  const { latest } = thread;
  const unread = thread.unreadCount > 0;
  const starred = latest.keywords.includes("$flagged");
  const sender = senderLabel(latest.from);

  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "o") onOpen();
      }}
      style={{ height: ROW_HEIGHT[density] }}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-3 border-b border-border-muted px-3 text-left",
        "transition-colors duration-[--duration-fast]",
        selected ? "bg-primary-muted" : "hover:bg-surface-sunken",
        active && "ring-2 ring-primary ring-inset"
      )}
    >
      {/* Unread rail. A 3px bar rather than a dot: it survives at compact
          density, where a dot competes with the checkbox for the same 16px. */}
      {unread && <span aria-hidden className="absolute left-0 top-0 h-full w-[3px] bg-primary" />}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          haptics.selection();
          onToggleSelect();
        }}
        // role="checkbox" with aria-checked, not a bare button: the control
        // has a checked STATE, and a button announces only its label. A
        // screen-reader user was told "Select subject, button" with no way to
        // know whether it already was selected.
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? `Deselect ${latest.subject}` : `Select ${latest.subject}`}
        className="shrink-0 rounded text-ink-muted transition-transform duration-[--duration-instant] hover:text-ink active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon icon={selected ? icons.messageState.checkboxOn : icons.messageState.checkboxOff} size="sm" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // Pulse only on the transition INTO starred. Animating the unstar
          // too would draw the eye to something being taken away, and
          // animating on mount would make every scroll a fireworks display.
          if (!starred) {
            setPulse(true);
            haptics.selection();
          }
          onToggleStar();
        }}
        aria-label={starred ? `Unstar ${latest.subject}` : `Star ${latest.subject}`}
        aria-pressed={starred}
        className={cn(
          "shrink-0 transition-colors duration-[--duration-micro]",
          starred ? "text-starred" : "text-ink-disabled hover:text-ink-muted"
        )}
      >
        <Icon
          icon={icons.mailbox.starred}
          size="sm"
          filled={starred}
          onAnimationEnd={() => setPulse(false)}
          className={cn(pulse && !reduced && "animate-[starPulse_280ms_cubic-bezier(0.2,0,0,1)]")}
        />
      </button>

      {density !== "compact" && (
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-primary-muted font-medium text-primary",
            density === "spacious" ? "size-9 text-sm" : "size-7 text-xs"
          )}
        >
          {initialsOf(sender)}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {density === "compact" ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className={cn("w-40 shrink-0 truncate text-sm", unread ? "font-semibold text-unread" : "text-read")}>
              {sender}
            </span>
            <span className={cn("truncate text-sm", unread ? "font-semibold text-unread" : "text-read")}>
              {latest.subject}
            </span>
            <span className="truncate text-sm text-ink-muted">— {latest.preview}</span>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className={cn("truncate text-md", unread ? "font-semibold text-unread" : "font-medium text-read")}>
                {sender}
              </span>
              {thread.messageCount > 1 && (
                <span className="shrink-0 text-xs text-ink-muted">{thread.messageCount}</span>
              )}
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className={cn("truncate text-sm", unread ? "font-semibold text-unread" : "text-read")}>
                {latest.subject}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm text-ink-muted",
                  density === "spacious" ? "line-clamp-2 whitespace-normal" : "truncate"
                )}
              >
                — {latest.preview}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <VerdictBadge verdict={latest.verdict} compact />
        {latest.hasAttachment && (
          <Icon
            icon={icons.messageState.attachment}
            size="sm"
            className="text-attachment"
            label={`${latest.attachments.length} attachment${latest.attachments.length === 1 ? "" : "s"}`}
          />
        )}
        <time
          dateTime={latest.receivedAt}
          className={cn("w-16 shrink-0 text-right text-xs tabular-nums", unread ? "font-medium text-ink" : "text-ink-muted")}
        >
          {formatListTimestamp(latest.receivedAt)}
        </time>
      </div>
    </div>
  );
}
