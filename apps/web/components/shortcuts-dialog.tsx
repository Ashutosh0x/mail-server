"use client";

import { useEffect, useRef } from "react";
import { Icon, icons } from "@mailserver/ui";

/**
 * The keyboard shortcut reference.
 *
 * Every entry below is wired in `mail-client.tsx`. Listing a shortcut that does
 * nothing is the same class of problem as a button that fails — someone will
 * press it and conclude the app is broken.
 */

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["J"], label: "Next message" },
      { keys: ["K"], label: "Previous message" },
      { keys: ["Enter"], label: "Open message" },
      { keys: ["O"], label: "Open message" },
      { keys: ["Esc"], label: "Close message" },
      { keys: [","], label: "Toggle sidebar" },
      { keys: ["/"], label: "Focus search" },
      { keys: ["?"], label: "This list" },
      { keys: ["C"], label: "Compose" },
    ],
  },
  {
    title: "Go to",
    items: [
      { keys: ["G", "I"], label: "Inbox" },
      { keys: ["G", "S"], label: "Sent" },
      { keys: ["G", "D"], label: "Drafts" },
      { keys: ["G", "A"], label: "Archive" },
      { keys: ["G", "T"], label: "Trash" },
      { keys: ["G", "P"], label: "Spam" },
    ],
  },
  {
    // These three need a conversation open, because they answer the message
    // being read rather than the one under the cursor.
    title: "While reading",
    items: [
      { keys: ["R"], label: "Reply" },
      { keys: ["A"], label: "Reply all" },
      { keys: ["F"], label: "Forward" },
    ],
  },
  {
    title: "Actions",
    items: [
      { keys: ["X"], label: "Select message" },
      { keys: ["S"], label: "Star or unstar" },
      { keys: ["E"], label: "Archive" },
      { keys: ["#"], label: "Move to trash" },
      { keys: ["U"], label: "Mark read or unread" },
    ],
  },
  {
    title: "Compose",
    items: [
      { keys: ["Ctrl", "Enter"], label: "Send" },
      { keys: ["Esc"], label: "Close composer (draft is kept)" },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface-raised p-5 shadow-lg sm:max-w-lg sm:rounded-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-semibold text-ink">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
          >
            <Icon icon={icons.chrome.close} size="md" label="Close" />
          </button>
        </div>

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={`${group.title}-${item.keys.join("")}-${item.label}`}
                    className="flex items-baseline justify-between gap-4 text-sm"
                  >
                    <span className="text-ink-secondary">{item.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((key, index) => (
                        <kbd
                          key={`${key}-${index}`}
                          className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-ink"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs text-ink-muted">
          Shortcuts are ignored while you are typing in a field.
        </p>
      </div>
    </div>
  );
}
