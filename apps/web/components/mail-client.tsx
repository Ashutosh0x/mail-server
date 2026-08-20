"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Label, Mailbox, Thread } from "@mailserver/types";
import { parseQuery, removeTermAt, termsOf } from "@mailserver/types";
import { Icon, cn, icons } from "@mailserver/ui";
import { api, ApiError, type SessionInfo } from "@/lib/api";
import { MailListItem, ROW_HEIGHT, type Density } from "./mail-list-item";
import { ReadingPane } from "./reading-pane";
import { Sidebar } from "./sidebar";
import { useToast } from "./interaction/toast";
import { useFlipList } from "./interaction/use-flip-list";
import { MailListSkeleton } from "./interaction/skeleton";
import { Swipeable } from "./interaction/swipeable";
import { ProfileMenu } from "./account/profile-menu";
import { AccountCenter, type AccountSection } from "./account/account-center";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Composer } from "./compose/composer";

const DENSITIES = [
  { id: "compact" as const, label: "Compact", icon: icons.settings.densityCompact },
  { id: "comfortable" as const, label: "Comfortable", icon: icons.settings.densityComfortable },
  { id: "spacious" as const, label: "Spacious", icon: icons.settings.densitySpacious },
];

/** Empty-state wording per mailbox role. Says what is true, offers no fiction. */
function emptyStateFor(role: Mailbox["role"], searching: boolean) {
  if (searching) {
    return { title: "No messages match", body: "Try removing a filter or searching for something else." };
  }
  switch (role) {
    case "inbox":
      return { title: "Your inbox is empty", body: "New messages will appear here." };
    case "sent":
      return { title: "No sent messages yet", body: "Messages you send will appear here." };
    case "drafts":
      return { title: "No drafts", body: "Drafts are saved here as you write." };
    case "archive":
      return { title: "Nothing archived", body: "Archived messages are kept out of your inbox." };
    case "junk":
      return { title: "No spam", body: "Messages we flag as spam appear here." };
    case "trash":
      return { title: "Trash is empty", body: "Deleted messages are kept here before removal." };
    default:
      return { title: "Nothing here yet", body: "This folder has no messages." };
  }
}

/**
 * The real inverse of each action, used by Undo.
 *
 * Only actions with a genuine reversal appear here. `delete` is absent
 * because nothing restores a permanently deleted message, and offering Undo
 * for it would be a promise the backend cannot keep.
 */
const INVERSE_ACTION: Record<string, string | undefined> = {
  archive: "restore",
  trash: "restore",
  spam: "restore",
  read: "unread",
  unread: "read",
  star: "unstar",
  unstar: "star",
};

const PAST_TENSE: Record<string, string> = {
  archive: "archived",
  trash: "moved to trash",
  spam: "marked as spam",
  restore: "restored",
  read: "marked read",
  unread: "marked unread",
  star: "starred",
  unstar: "unstarred",
  delete: "deleted",
};

export function MailClient({ user, onSignOut }: { user: SessionInfo; onSignOut: () => void }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Rows below a removed message slide up to close the gap rather than
  // jumping. Keyed on the thread ids, which is exactly what changes when
  // the list reorders.
  const threadIds = useMemo(() => (threads ?? []).map((thread) => thread.id), [threads]);
  const { register, measure } = useFlipList(threadIds);

  const [activeMailboxId, setActiveMailboxId] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>("comfortable");
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<Thread | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  /** Null when the account center is closed. */
  const [accountSection, setAccountSection] = useState<AccountSection | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  /** Set when the composer is opening onto an existing draft rather than a new one. */
  const [reopenDraftId, setReopenDraftId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const parsed = useMemo(() => parseQuery(query), [query]);
  const chips = useMemo(() => termsOf(parsed), [parsed]);
  const activeMailbox = mailboxes?.find((m) => m.id === activeMailboxId) ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Below md the sidebar is forced to its icon rail. A 224px sidebar next
  // to a 420px list needs 644px; on a 390px screen the list was rendering
  // partly off-viewport, which is why nothing could be tapped or swiped
  // there. Done in state rather than CSS because the sidebar decides what
  // to render from `collapsed`, not just how wide to be.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = (narrow: boolean) => {
      if (narrow) setSidebarCollapsed(true);
    };
    apply(query.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Search is debounced so a typed query is one request, not one per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const loadFolders = useCallback(async () => {
    const [boxes, labelList] = await Promise.all([api.mailboxes(), api.labels()]);
    setMailboxes(boxes.mailboxes);
    setLabels(labelList.labels);
    setActiveMailboxId((current) => current ?? boxes.mailboxes.find((m) => m.role === "inbox")?.id ?? boxes.mailboxes[0]?.id ?? null);
  }, []);

  // A superseded request must not overwrite a newer one's results.
  const requestSeq = useRef(0);

  const loadThreads = useCallback(
    async (mailboxId: string | null, search: string) => {
      if (!mailboxId) return;
      const seq = ++requestSeq.current;
      setListLoading(true);
      try {
        const page = await api.threads({ mailboxId, q: search || undefined });
        if (seq !== requestSeq.current) return;
        setThreads(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setThreads(null);
        setError(err instanceof ApiError ? err.message : "Could not load messages.");
      } finally {
        if (seq === requestSeq.current) setListLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadFolders();
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your mailboxes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFolders]);

  useEffect(() => {
    void loadThreads(activeMailboxId, debouncedQuery);
  }, [activeMailboxId, debouncedQuery, loadThreads]);

  useEffect(() => {
    setOpenThread(threads?.find((t) => t.id === openId) ?? null);
  }, [threads, openId]);

  const act = useCallback(
    async (action: string, ids: string[], optimistic?: () => void, revert?: () => void) => {
      // Measure before the list reorders, so the rows below can slide into the
      // gap instead of jumping.
      measure();
      optimistic?.();
      try {
        const result = await api.act(action, ids);
        await Promise.all([loadFolders(), loadThreads(activeMailboxId, debouncedQuery)]);

        const inverse = INVERSE_ACTION[action];
        toast.show(
          `${result.changed} message${result.changed === 1 ? "" : "s"} ${PAST_TENSE[action] ?? action}`,
          {
            tone: "success",
            // Undo is offered only where a real inverse call exists. An Undo
            // button that cannot reverse anything is worse than no button.
            onUndo: inverse
              ? async () => {
                  measure();
                  await api.act(inverse, ids);
                  await Promise.all([loadFolders(), loadThreads(activeMailboxId, debouncedQuery)]);
                }
              : undefined,
          }
        );
      } catch (err) {
        // The server is the truth. A failed mutation rolls the UI back rather
        // than leaving it showing something that did not happen.
        revert?.();
        toast.show(err instanceof ApiError ? err.message : "That action failed.", { tone: "error" });
      }
    },
    [activeMailboxId, debouncedQuery, loadFolders, loadThreads, toast, measure]
  );

  const visible = threads ?? [];

  const toggleSet = (set: Set<string>, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  // Keyboard map (Section 33). Ignored while a field has focus.
  useEffect(() => {
    // An overlay owns the keyboard while it is open. Without this, `j` scrolls
    // the message list behind the account center and Escape closes both.
    if (accountSection !== null || shortcutsOpen || composing) return undefined;

    let pendingG = false;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable === true;
      if (typing) {
        if (event.key === "Escape") target?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (pendingG) {
        pendingG = false;
        const roles: Record<string, string> = { i: "inbox", s: "sent", d: "drafts", a: "archive", t: "trash", p: "junk" };
        const box = mailboxes?.find((m) => m.role === roles[event.key.toLowerCase()]);
        if (box) {
          setActiveMailboxId(box.id);
          setCursor(0);
          setOpenId(null);
          event.preventDefault();
        }
        return;
      }

      const currentId = visible[cursor]?.latest.id;
      switch (event.key) {
        case "j": setCursor((c) => Math.min(c + 1, Math.max(visible.length - 1, 0))); event.preventDefault(); break;
        case "k": setCursor((c) => Math.max(c - 1, 0)); event.preventDefault(); break;
        case "Enter":
        case "o": setOpenId(visible[cursor]?.id ?? null); event.preventDefault(); break;
        case "Escape": setOpenId(null); break;
        case "x": if (visible[cursor]) setSelected((s) => toggleSet(s, visible[cursor]!.id)); event.preventDefault(); break;
        case "s":
        case "*": if (currentId) void act(visible[cursor]!.latest.keywords.includes("$flagged") ? "unstar" : "star", [currentId]); event.preventDefault(); break;
        case "e": if (currentId) void act("archive", [currentId]); event.preventDefault(); break;
        case "#": if (currentId) void act("trash", [currentId]); event.preventDefault(); break;
        case "u": if (currentId) void act(visible[cursor]!.unreadCount > 0 ? "read" : "unread", [currentId]); event.preventDefault(); break;
        case "g": pendingG = true; break;
        case "c": setComposing(true); event.preventDefault(); break;
        case "/": document.getElementById("mail-search")?.focus(); event.preventDefault(); break;
        case ",": setSidebarCollapsed((v) => !v); event.preventDefault(); break;
        default: break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, cursor, mailboxes, act, accountSection, shortcutsOpen, composing]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <div className="flex items-center gap-2 text-ink-muted">
          <Icon icon={icons.status.loading} size="md" className="animate-spin" />
          Loading your mailbox…
        </div>
      </div>
    );
  }

  if (error && !mailboxes) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
        <Icon icon={icons.status.error} size="hero" className="text-danger" />
        <h1 className="text-lg font-semibold text-ink">Could not load your mailbox</h1>
        <p className="max-w-md text-sm text-ink-secondary">{error}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); void loadFolders().finally(() => setLoading(false)); }}
          className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-ink hover:bg-primary-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  const empty = emptyStateFor(activeMailbox?.role ?? null, debouncedQuery.length > 0);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <Sidebar
        mailboxes={mailboxes ?? []}
        labels={labels}
        activeMailboxId={activeMailboxId ?? ""}
        collapsed={sidebarCollapsed}
        onSelect={(id) => { setActiveMailboxId(id); setCursor(0); setOpenId(null); }}
        onCompose={() => setComposing(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
          >
            <Icon icon={sidebarCollapsed ? icons.chrome.expandSidebar : icons.chrome.collapseSidebar} size="md"
                  label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} />
          </button>

          <div className="relative flex max-w-xl flex-1 items-center">
            <Icon icon={icons.search.search} size="sm" className="absolute left-3 text-ink-muted" />
            <input
              id="mail-search"
              type="search"
              role="searchbox"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mail —  from:  has:attachment  is:unread  newer:7d"
              className="w-full rounded-lg border border-border bg-canvas py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-primary"
            />
            {listLoading && (
              <Icon icon={icons.status.loading} size="sm" className="absolute right-3 animate-spin text-ink-muted" />
            )}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {DENSITIES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDensity(option.id)}
                aria-pressed={density === option.id}
                title={`${option.label} density`}
                className={cn("rounded-md p-1.5", density === option.id ? "bg-primary-muted text-primary" : "text-ink-secondary hover:bg-surface-sunken hover:text-ink")}
              >
                <Icon icon={option.icon} size="md" label={`${option.label} density`} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              <Icon icon={theme === "light" ? icons.settings.dark : icons.settings.light} size="md"
                    label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} />
            </button>
            <div className="relative">
              <ProfileMenu
                user={{ displayName: user.displayName, email: user.email }}
                onSignOut={onSignOut}
                onOpenAccount={(section) => setAccountSection((section as AccountSection) ?? "profile")}
                theme={theme}
                onThemeChange={setTheme}
                density={density}
                onDensityChange={setDensity}
                onShowShortcuts={() => setShortcutsOpen(true)}
              />
            </div>
          </div>
        </header>

        {(chips.length > 0 || parsed.unknownFields.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2">
            {chips.map((chip) => (
              <button
                key={`${chip.field}-${chip.start}`}
                type="button"
                onClick={() => setQuery((q) => removeTermAt(q, chip.start, chip.end))}
                className="inline-flex items-center gap-1 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-medium text-primary"
              >
                {chip.negated && "-"}{chip.field}: {chip.value}
                <Icon icon={icons.chrome.close} size="xs" label={`Remove ${chip.field} filter`} />
              </button>
            ))}
            {parsed.unknownFields.map((unknown) => (
              <span
                key={`${unknown.name}-${unknown.start}`}
                className="inline-flex items-center gap-1 rounded-full bg-warning-muted px-2.5 py-1 text-xs font-medium text-warning-ink"
                title={`"${unknown.name}:" is not a search operator — searching for it as text`}
              >
                <Icon icon={icons.chrome.warning} size="xs" />
                {unknown.name}: not an operator
              </span>
            ))}
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          <div
            role="grid"
            aria-label={`${activeMailbox?.name ?? "Mail"} messages`}
            aria-rowcount={visible.length}
            aria-busy={listLoading}
            className="flex w-full shrink-0 flex-col overflow-y-auto border-r border-border bg-canvas md:w-[420px]"
          >
            {listLoading && visible.length === 0 ? (
              <MailListSkeleton density={density} rows={8} />
            ) : visible.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <Icon icon={icons.mailbox.inbox} size="xl" className="text-ink-disabled" />
                <p className="font-medium text-ink-secondary">{empty.title}</p>
                <p className="text-sm text-ink-muted">{empty.body}</p>
              </div>
            ) : (
              visible.map((thread, index) => (
                <Swipeable
                  key={thread.id}
                  // Archive is one Undo away, so it activates early. Trash is
                  // destructive and demands roughly twice the travel.
                  right={{
                    id: "archive",
                    label: "Archive",
                    icon: icons.threadAction.archive,
                    className: "bg-success-muted text-success-ink",
                    onAction: () => void act("archive", [thread.latest.id]),
                  }}
                  left={{
                    id: "read",
                    label: thread.unreadCount > 0 ? "Mark read" : "Mark unread",
                    icon: icons.messageState.read,
                    className: "bg-primary-muted text-primary",
                    onAction: () =>
                      void act(thread.unreadCount > 0 ? "read" : "unread", [thread.latest.id]),
                  }}
                >
                <div ref={register(thread.id)}>
                <MailListItem
                  thread={thread}
                  density={density}
                  selected={selected.has(thread.id)}
                  active={index === cursor}
                  onOpen={() => {
                    setCursor(index);

                    // A draft is not something to read — opening it means
                    // resuming it. The row's latest message IS the draft row.
                    if (activeMailbox?.role === "drafts") {
                      setReopenDraftId(thread.latest.id);
                      setComposing(true);
                      return;
                    }

                    setOpenId(thread.id);
                    if (thread.unreadCount > 0) void act("read", [thread.latest.id]);
                  }}
                  onToggleSelect={() => setSelected((s) => toggleSet(s, thread.id))}
                  onToggleStar={() =>
                    void act(thread.latest.keywords.includes("$flagged") ? "unstar" : "star", [thread.latest.id])
                  }
                />
                </div>
                </Swipeable>
              ))
            )}
          </div>

          {/* Below md the reading pane covers the list rather than sitting
              beside it — there is not room for both, and a 420px pane squeezed
              into 390px is how rows ended up off-screen. */}
          <div
            className={cn(
              "min-w-0 flex-1",
              openThread
                ? "absolute inset-0 z-20 bg-canvas md:static md:z-auto"
                : "hidden md:block"
            )}
          >
            <ReadingPane thread={openThread} />
          </div>
        </div>

        <footer className="flex items-center gap-4 border-t border-border bg-surface px-4 py-1.5 text-xs text-ink-muted">
          <span>
            {total} conversation{total === 1 ? "" : "s"}
            {selected.size > 0 && ` · ${selected.size} selected`}
            {nextCursor && " · more available"}
          </span>
          {selected.size > 0 && (
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => void act("archive", visible.filter((t) => selected.has(t.id)).map((t) => t.latest.id))}
                      className="rounded px-2 py-0.5 hover:bg-surface-sunken hover:text-ink">Archive</button>
              <button type="button" onClick={() => void act("trash", visible.filter((t) => selected.has(t.id)).map((t) => t.latest.id))}
                      className="rounded px-2 py-0.5 hover:bg-surface-sunken hover:text-ink">Delete</button>
              <button type="button" onClick={() => void act("read", visible.filter((t) => selected.has(t.id)).map((t) => t.latest.id))}
                      className="rounded px-2 py-0.5 hover:bg-surface-sunken hover:text-ink">Mark read</button>
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            <span><Key>J</Key><Key>K</Key> move</span>
            <span><Key>E</Key> archive</span>
            <span><Key>S</Key> star</span>
            <span><Key>/</Key> search</span>
          </span>
        </footer>
      </div>

      {accountSection !== null && (
        <AccountCenter
          section={accountSection}
          onSectionChange={setAccountSection}
          onClose={() => setAccountSection(null)}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

      {composing && (
        <Composer
          // Remounts when the target draft changes, so the composer starts
          // from that draft rather than trying to swap content underneath.
          key={reopenDraftId ?? "new"}
          openDraftId={reopenDraftId ?? undefined}
          onClose={() => {
            setComposing(false);
            setReopenDraftId(null);
            // The draft's preview may have changed while it was open.
            void loadThreads(activeMailboxId, debouncedQuery);
          }}
          onSent={() => {
            // Refresh so the message appears in Sent and the counts move.
            void loadFolders();
            void loadThreads(activeMailboxId, debouncedQuery);
          }}
        />
      )}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-0.5 rounded border border-border bg-canvas px-1 py-0.5 font-mono text-[10px] text-ink-secondary">
      {children}
    </kbd>
  );
}

export { ROW_HEIGHT };
