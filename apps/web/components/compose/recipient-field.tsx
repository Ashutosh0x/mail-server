"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon, cn, haptics, icons } from "@mailserver/ui";
import { isValidAddress } from "@/lib/address";
import { api } from "@/lib/api";

export interface Recipient {
  name?: string | null;
  email: string;
}

/**
 * Recipient chips.
 *
 * Commit on Enter, comma, semicolon, Tab or blur — all five, because people
 * have habits from different clients and losing a typed address because the
 * wrong key was pressed is the kind of thing that makes someone stop trusting
 * a composer.
 *
 * An invalid address still becomes a chip, marked invalid, rather than being
 * silently dropped or blocking the field. The user can see what they typed and
 * fix it; discarding their input to enforce a rule is worse than showing the
 * problem.
 */
export function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
  id,
}: {
  label: string;
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  autoFocus?: boolean;
  id: string;
}) {
  const [draft, setDraft] = useState("");

  /**
   * Suggestions from addresses this user has actually written to.
   *
   * There is no contact store, so these come from their own sent mail. A
   * brand-new account gets no suggestions, which is the correct answer
   * rather than a seeded address book.
   */
  const [suggestions, setSuggestions] = useState<{ name: string | null; email: string; count: number }[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const listId = useId();

  useEffect(() => {
    const query = draft.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return undefined;
    }
    // Debounced: one request per pause, not one per keystroke.
    const timer = window.setTimeout(() => {
      void api
        .recipientSuggestions(query)
        .then((result) => {
          // Never suggest someone already on the message.
          const chosen = new Set(value.map((r) => r.email.toLowerCase()));
          setSuggestions(result.recipients.filter((r) => !chosen.has(r.email.toLowerCase())));
          setHighlighted(-1);
        })
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, value]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseRecipients(raw);
      if (parsed.length === 0) return;

      // Case-insensitive de-duplication: an address is the same address
      // whatever case it was typed in.
      const seen = new Set(value.map((r) => r.email.toLowerCase()));
      const additions = parsed.filter((r) => !seen.has(r.email.toLowerCase()));

      if (additions.length > 0) {
        haptics.selection();
        onChange([...value, ...additions]);
      }
      setDraft("");
    },
    [value, onChange]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Arrow keys walk the suggestion list before anything else claims them.
      if (suggestions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setHighlighted((current) => {
          const next = event.key === "ArrowDown" ? current + 1 : current - 1;
          if (next < -1) return suggestions.length - 1;
          if (next >= suggestions.length) return -1;
          return next;
        });
        return;
      }
      if (event.key === "Escape" && suggestions.length > 0) {
        event.preventDefault();
        setSuggestions([]);
        return;
      }

      if (event.key === "Enter" || event.key === "," || event.key === ";") {
        event.preventDefault();
        // Enter takes the highlighted suggestion when there is one.
        const picked = highlighted >= 0 ? suggestions[highlighted] : null;
        if (picked) {
          onChange([...value, { name: picked.name, email: picked.email }]);
          setDraft("");
          setSuggestions([]);
          setHighlighted(-1);
          haptics.selection();
          return;
        }
        commit(draft);
        return;
      }
      if (event.key === "Tab" && draft.trim()) {
        // Commit but let focus move on: interrupting Tab would trap the user.
        commit(draft);
        return;
      }
      // Backspace on an empty field edits the previous chip rather than
      // deleting it outright, so one keystroke never loses a whole address.
      if (event.key === "Backspace" && draft === "" && value.length > 0) {
        event.preventDefault();
        const last = value[value.length - 1]!;
        onChange(value.slice(0, -1));
        setDraft(last.name ? `${last.name} <${last.email}>` : last.email);
      }
    },
    [draft, commit, value, onChange, suggestions, highlighted]
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData("text");
      // Multiple addresses at once is the normal case when pasting from
      // another client, so handle it rather than dropping all but the first.
      if (/[,;\n]/.test(text)) {
        event.preventDefault();
        commit(text);
      }
    },
    [commit]
  );

  return (
    <div className="relative flex items-start gap-2 border-b border-border px-3 py-1.5">
      <label htmlFor={id} className="mt-1.5 w-10 shrink-0 text-xs text-ink-muted">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
        {value.map((recipient, index) => {
          const valid = isValidAddress(recipient.email);
          return (
            <span
              key={`${recipient.email}-${index}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                valid ? "bg-surface-sunken text-ink" : "bg-danger-muted text-danger-ink"
              )}
              // Invalid addresses are announced, not just coloured.
              title={valid ? recipient.email : `${recipient.email} — check this address`}
            >
              {!valid && <Icon icon={icons.status.warning} size="sm" className="shrink-0" />}
              <span className="truncate">{recipient.name || recipient.email}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`Remove ${recipient.email}`}
                className="shrink-0 rounded-full p-0.5 hover:bg-border"
              >
                <Icon icon={icons.chrome.close} size="sm" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoFocus={autoFocus}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(draft)}
          // `email` rather than `off` so the browser can offer addresses the
          // user has typed before. There is no contact store to autocomplete
          // from yet, and inventing one would be fake data.
          autoComplete="email"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
          placeholder={value.length === 0 ? "Add recipients" : ""}
        />
      </div>

      {suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Recent recipients"
          className="absolute left-12 right-3 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.email} id={`${listId}-${index}`} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                // mousedown, not click: click fires after blur, which would
                // have already committed the half-typed text as a recipient.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange([...value, { name: suggestion.name, email: suggestion.email }]);
                  setDraft("");
                  setSuggestions([]);
                  haptics.selection();
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left",
                  index === highlighted ? "bg-primary-muted" : "hover:bg-surface-sunken"
                )}
              >
                <span className="min-w-0 flex-1">
                  {suggestion.name && (
                    <span className="block truncate text-sm text-ink">{suggestion.name}</span>
                  )}
                  <span className="block truncate text-xs text-ink-muted">{suggestion.email}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-muted">
                  {suggestion.count} sent
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Parse one or more addresses from free text.
 *
 * Handles `Name <a@b.com>`, bare addresses, and any of comma, semicolon or
 * newline as a separator — the three things that come out of a real address
 * book when you copy from one.
 */
export function parseRecipients(input: string): Recipient[] {
  return input
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const angled = part.match(/^(.*?)\s*<([^>]+)>$/);
      if (angled) {
        const name = angled[1]!.trim().replace(/^["']|["']$/g, "");
        return { name: name || null, email: angled[2]!.trim() };
      }
      return { name: null, email: part };
    })
    .filter((recipient) => recipient.email.length > 0);
}
