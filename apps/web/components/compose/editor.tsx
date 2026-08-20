"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, cn, haptics, icons, type LucideIcon } from "@mailserver/ui";
import { isSafeUrl } from "@/lib/server/sanitize";

/**
 * The message editor.
 *
 * Built on `contentEditable` with `document.execCommand`, deliberately, rather
 * than on TipTap or Lexical. The reasoning:
 *
 *   - The formatting set a mail composer needs is small and closed: bold,
 *     italic, underline, strike, lists, quote, code, link, clear. That is
 *     execCommand's whole competence.
 *   - The alternative is 30–100KB of runtime for a document model this feature
 *     set does not need, in a repository that already carries eight declared
 *     dependencies nothing imports.
 *   - execCommand is deprecated but is not going away — every major webmail
 *     still relies on it, and no browser has signalled removal.
 *
 * The honest cost: execCommand's output varies between engines, and it has no
 * document model, so anything structural (tables, collaborative editing,
 * reliable undo grouping) would need a real editor. Recorded rather than
 * glossed — if this composer grows those requirements, the right answer is to
 * migrate, not to keep patching.
 *
 * Security note: nothing here is a security boundary. The authoritative
 * sanitisation happens on the SERVER when the draft is saved, because anything
 * can POST to the API directly. The paste handler below is about not pasting
 * a webpage's styling into an email, not about safety.
 */

interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  /** execCommand name, or a custom handler. */
  command?: string;
  value?: string;
  shortcut?: string;
}

const HISTORY: Command[] = [
  { id: "undo", label: "Undo", icon: icons.editor.undo, command: "undo", shortcut: "Ctrl+Z" },
  { id: "redo", label: "Redo", icon: icons.editor.redo, command: "redo", shortcut: "Ctrl+Shift+Z" },
];

const PRIMARY: Command[] = [
  { id: "bold", label: "Bold", icon: icons.editor.bold, command: "bold", shortcut: "Ctrl+B" },
  { id: "italic", label: "Italic", icon: icons.editor.italic, command: "italic", shortcut: "Ctrl+I" },
  { id: "underline", label: "Underline", icon: icons.editor.underline, command: "underline", shortcut: "Ctrl+U" },
  { id: "strike", label: "Strikethrough", icon: icons.editor.strikethrough, command: "strikeThrough" },
];

const SECONDARY: Command[] = [
  { id: "ul", label: "Bulleted list", icon: icons.editor.bulletList, command: "insertUnorderedList" },
  { id: "ol", label: "Numbered list", icon: icons.editor.orderedList, command: "insertOrderedList" },
  { id: "quote", label: "Quote", icon: icons.editor.blockquote, command: "formatBlock", value: "blockquote" },
  { id: "code", label: "Code", icon: icons.editor.codeBlock, command: "formatBlock", value: "pre" },
];

export function Editor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);

  /**
   * The last HTML this editor reported upwards.
   *
   * Only a value from OUTSIDE may be written into the DOM — writing back what
   * the user just typed would move the caret to the start on every keystroke.
   * Remembering what we emitted is what tells the two apart. Running on mount
   * alone is not enough: a reopened draft arrives after the fetch resolves,
   * and that content would never reach the DOM.
   */
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (value === lastEmitted.current) return;
    if (node.innerHTML !== value) node.innerHTML = value;
  }, [value]);

  const emit = useCallback(() => {
    if (!ref.current) return;
    lastEmitted.current = ref.current.innerHTML;
    onChange(ref.current.innerHTML);
  }, [onChange]);

  /** Reflect the caret's formatting so the toolbar shows real state. */
  const syncActive = useCallback(() => {
    const next = new Set<string>();
    for (const command of [...PRIMARY, ...SECONDARY]) {
      if (!command.command) continue;
      try {
        if (command.value) {
          const block = document.queryCommandValue("formatBlock").toLowerCase();
          if (block === command.value) next.add(command.id);
        } else if (document.queryCommandState(command.command)) {
          next.add(command.id);
        }
      } catch {
        // queryCommandState throws in some engines for some commands; an
        // unknown state is better than a crashed toolbar.
      }
    }
    setActive(next);
  }, []);

  const run = useCallback(
    (command: Command) => {
      ref.current?.focus();
      haptics.selection();
      try {
        document.execCommand(command.command!, false, command.value);
      } catch {
        // Nothing to do: the command is unsupported here, and the document is
        // unchanged.
      }
      syncActive();
      emit();
    },
    [emit, syncActive]
  );

  const applyLink = useCallback(() => {
    const url = linkUrl.trim();
    // Checked before insertion so a `javascript:` URL is refused where the
    // user can see why, rather than silently stripped by the server later.
    if (!isSafeUrl(url)) return;

    ref.current?.focus();
    // Restore the selection the dialog stole when it opened.
    if (savedRange.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange.current);
    }
    document.execCommand("createLink", false, url);
    setLinkOpen(false);
    setLinkUrl("");
    emit();
  }, [linkUrl, emit]);

  const openLink = useCallback(() => {
    const selection = window.getSelection();
    savedRange.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkOpen(true);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      // Ctrl/Cmd+K for a link is the near-universal convention.
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        openLink();
        return;
      }
      // B, I and U are handled natively by contentEditable; nothing to add.
      if (mod && event.shiftKey && event.key === "7") {
        event.preventDefault();
        run(SECONDARY[1]!);
      }
      if (mod && event.shiftKey && event.key === "8") {
        event.preventDefault();
        run(SECONDARY[0]!);
      }
    },
    [openLink, run]
  );

  /**
   * Paste as plain text.
   *
   * Pasting rich HTML from a webpage drags in that page's fonts, colours and
   * layout, which then get stripped by the server's sanitiser anyway — so the
   * user would see formatting appear and then vanish. Plain text is what they
   * almost always meant.
   */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
      emit();
    },
    [emit]
  );

  const empty = value.replace(/<[^>]*>/g, "").trim().length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label="Formatting"
        aria-controls="compose-editor"
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1"
      >
        {HISTORY.map((command) => (
          <ToolbarButton key={command.id} command={command} active={false} onRun={() => run(command)} />
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        {PRIMARY.map((command) => (
          <ToolbarButton
            key={command.id}
            command={command}
            active={active.has(command.id)}
            onRun={() => run(command)}
          />
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        {SECONDARY.map((command) => (
          <ToolbarButton
            key={command.id}
            command={command}
            active={active.has(command.id)}
            onRun={() => run(command)}
          />
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={openLink}
          title="Insert link (Ctrl+K)"
          aria-label="Insert link"
          className="shrink-0 rounded p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Icon icon={icons.editor.link} size="sm" />
        </button>
        <button
          type="button"
          onClick={() => {
            ref.current?.focus();
            document.execCommand("removeFormat");
            document.execCommand("unlink");
            syncActive();
            emit();
          }}
          title="Clear formatting"
          aria-label="Clear formatting"
          className="shrink-0 rounded p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Icon icon={icons.editor.clearFormatting} size="sm" />
        </button>
      </div>

      {linkOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-2 py-1.5">
          <input
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://example.com"
            aria-label="Link address"
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={applyLink}
            disabled={!isSafeUrl(linkUrl.trim())}
            className="shrink-0 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-ink disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="shrink-0 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-border"
          >
            Cancel
          </button>
          {linkUrl.trim() && !isSafeUrl(linkUrl.trim()) && (
            <span role="alert" className="shrink-0 text-xs text-danger">
              Only web, mail and phone links are allowed.
            </span>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {empty && placeholder && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3 text-sm text-ink-muted"
          >
            {placeholder}
          </span>
        )}
        <div
          id="compose-editor"
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Message body"
          spellCheck
          onInput={emit}
          onKeyUp={syncActive}
          onMouseUp={syncActive}
          onFocus={syncActive}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={cn(
            "h-full overflow-y-auto p-3 text-sm leading-relaxed text-ink outline-none",
            // Formatting produced by execCommand needs visible styling; the
            // email itself carries its own semantics through tags.
            "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary",
            "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
            "[&_pre]:rounded [&_pre]:bg-surface-sunken [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs",
            "[&_a]:text-primary [&_a]:underline"
          )}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  command,
  active,
  onRun,
}: {
  command: Command;
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      // `onMouseDown` with preventDefault, not `onClick`: clicking a button
      // would blur the editor and collapse the selection before the command
      // could apply to it.
      onMouseDown={(event) => {
        event.preventDefault();
        onRun();
      }}
      aria-pressed={active}
      title={command.shortcut ? `${command.label} (${command.shortcut})` : command.label}
      aria-label={command.label}
      className={cn(
        "shrink-0 rounded p-1.5 transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        active ? "bg-primary-muted text-primary" : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
      )}
    >
      <Icon icon={command.icon} size="sm" />
    </button>
  );
}
