"use client";

import { useCallback, useRef, useState } from "react";
import { Icon, cn, haptics, icons } from "@mailserver/ui";
import { isValidAddress } from "@/lib/address";

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
      if (event.key === "Enter" || event.key === "," || event.key === ";") {
        event.preventDefault();
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
    [draft, commit, value, onChange]
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
    <div className="flex items-start gap-2 border-b border-border px-3 py-1.5">
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
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
          placeholder={value.length === 0 ? "Add recipients" : ""}
        />
      </div>
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
