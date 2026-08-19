"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, cn, icons } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import type { AccountOverview } from "@/lib/account-types";
import { Avatar } from "./avatar";
import { MenuItem, MenuSection, MenuSeparator, UnavailableRow } from "./menu-primitives";
import { SecurityStatus } from "./security-status";
import { StorageUsage } from "./storage-usage";

/**
 * The account center, opened from the avatar in the header.
 *
 * Behaviour that a plain dropdown gets wrong and this does not:
 *
 *   - Focus moves INTO the panel on open and RETURNS to the trigger on close,
 *     so a keyboard user is never dropped at the top of the document.
 *   - Arrow keys move between items, Tab leaves. That is the menu pattern;
 *     making Tab walk 15 rows is the most common mistake here.
 *   - Escape and outside-click both close, and Escape is captured on the panel
 *     rather than the window so it does not fight other handlers.
 *   - Data is fetched on FIRST open, not on mount. The header should not pay
 *     for a panel most sessions never open.
 *   - Under 640px it becomes a bottom sheet, because a 380px panel anchored to
 *     the top-right corner of a phone is unusable.
 */

type Panel = "root" | "appearance";

export function ProfileMenu({
  user,
  onSignOut,
  onOpenAccount,
  theme,
  onThemeChange,
  density,
  onDensityChange,
  onShowShortcuts,
}: {
  user: { displayName: string; email: string };
  onSignOut: () => void;
  onOpenAccount: (section?: string) => void;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  density: "compact" | "comfortable" | "spacious";
  onDensityChange: (density: "compact" | "comfortable" | "spacious") => void;
  onShowShortcuts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("root");
  const [data, setData] = useState<AccountOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // ── Data, fetched on first open ────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.account());
    } catch (cause) {
      // Show the failure. Never fall back to a plausible-looking account.
      setError(cause instanceof ApiError ? cause.message : "Could not load your account.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data && !loading && !error) void load();
  }, [open, data, loading, error, load]);

  // ── Close on outside click ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      // The trigger toggles itself; letting this handler also fire would close
      // and immediately reopen.
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // ── Focus in on open, back to the trigger on close ─────────────────────
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // After paint, so the items exist to receive focus.
      const id = window.requestAnimationFrame(() => {
        const first = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
        first?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
    setPanel("root");
    return undefined;
  }, [open]);

  // ── Roving focus ───────────────────────────────────────────────────────
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      // Tab leaves the menu entirely, per the menu pattern.
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }

    event.preventDefault();
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    if (items.length === 0) return;

    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (index + 1) % items.length
      // Wraps to the end from -1 too, which is what an unfocused menu should do.
      : (index - 1 + items.length) % items.length;

    items[next]?.focus();
  }, []);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }, [onSignOut]);

  const go = useCallback(
    (section?: string) => {
      setOpen(false);
      onOpenAccount(section);
    },
    [onOpenAccount]
  );

  const profile = data?.profile;
  const displayName = profile?.displayName ?? user.displayName;
  const email = profile?.email ?? user.email;

  const themeOptions = useMemo(
    () =>
      [
        { id: "light" as const, label: "Light", icon: icons.settings.light },
        { id: "dark" as const, label: "Dark", icon: icons.settings.dark },
      ],
    []
  );

  const densityOptions = useMemo(
    () =>
      [
        { id: "compact" as const, label: "Compact", icon: icons.settings.densityCompact },
        { id: "comfortable" as const, label: "Comfortable", icon: icons.settings.densityComfortable },
        { id: "spacious" as const, label: "Spacious", icon: icons.settings.densitySpacious },
      ],
    []
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(
          "ml-1 flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-sm transition-colors",
          open ? "bg-surface-sunken text-ink" : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
        )}
      >
        <Avatar name={displayName} email={email} size="sm" />
        <span className="hidden max-w-[14ch] truncate sm:inline">{displayName}</span>
        <Icon
          icon={icons.chrome.chevronDown}
          size="sm"
          className={cn("hidden transition-transform sm:block", open && "rotate-180")}
          label="Account menu"
        />
      </button>

      {open && (
        <>
          {/* Scrim: mobile only. On desktop the outside-click handler is enough
              and a scrim would dim the mail the user is looking at. */}
          <div
            className="fixed inset-0 z-40 bg-black/25 sm:hidden"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />

          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label="Account"
            onKeyDown={onKeyDown}
            className={cn(
              "z-50 flex flex-col overflow-hidden border border-border bg-surface-raised shadow-lg",
              // Mobile: bottom sheet, safe-area aware.
              "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
              "motion-safe:animate-[slideUp_180ms_ease-out]",
              // Desktop: anchored panel.
              "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-1.5",
              "sm:max-h-[min(80vh,40rem)] sm:w-[22.5rem] sm:rounded-xl md:w-[24rem]",
              "sm:motion-safe:animate-[menuIn_150ms_ease-out]"
            )}
          >
            {/* Grab handle, mobile only. */}
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {panel === "root" ? (
                <RootPanel
                  loading={loading}
                  error={error}
                  data={data}
                  displayName={displayName}
                  email={email}
                  signingOut={signingOut}
                  onRetry={() => void load()}
                  onGo={go}
                  onAppearance={() => setPanel("appearance")}
                  onShortcuts={() => {
                    setOpen(false);
                    onShowShortcuts();
                  }}
                  onSignOut={() => void handleSignOut()}
                />
              ) : (
                <AppearancePanel
                  theme={theme}
                  themeOptions={themeOptions}
                  onThemeChange={onThemeChange}
                  density={density}
                  densityOptions={densityOptions}
                  onDensityChange={onDensityChange}
                  onBack={() => setPanel("root")}
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Root panel ─────────────────────────────────────────────────────────────

function RootPanel({
  loading,
  error,
  data,
  displayName,
  email,
  signingOut,
  onRetry,
  onGo,
  onAppearance,
  onShortcuts,
  onSignOut,
}: {
  loading: boolean;
  error: string | null;
  data: AccountOverview | null;
  displayName: string;
  email: string;
  signingOut: boolean;
  onRetry: () => void;
  onGo: (section?: string) => void;
  onAppearance: () => void;
  onShortcuts: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      {/* Identity renders from the session immediately, so the panel is never
          blank while /api/account is in flight. */}
      <div className="flex flex-col items-center gap-2 px-4 pb-3 pt-4 text-center">
        <Avatar name={displayName} email={email} size="lg" />
        <div className="min-w-0 max-w-full">
          <div className="truncate text-[15px] font-semibold text-ink">{displayName}</div>
          <div className="truncate text-sm text-ink-secondary">{email}</div>
          {data?.profile.organization?.name && (
            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Icon icon={icons.account.organization} size="sm" />
              <span className="truncate">{data.profile.organization.name}</span>
            </div>
          )}
        </div>
      </div>

      <div className="px-2">
        {loading && <SecuritySkeleton />}

        {error && (
          <div className="rounded-lg bg-danger-muted px-3 py-2.5">
            <p className="text-sm text-danger-ink">{error}</p>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={onRetry}
              className="mt-1.5 text-sm font-medium text-danger-ink underline focus:outline-none"
            >
              Try again
            </button>
          </div>
        )}

        {data && <SecurityStatus posture={data.security} onOpen={() => onGo("security")} />}
      </div>

      <div className="px-2 pt-1">
        <MenuItem
          icon={icons.account.profile}
          label="Manage your account"
          onClick={() => onGo()}
          navigates
        />
      </div>

      {data && (
        <>
          <MenuSeparator />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => onGo("storage")}
            className="w-full text-left transition-colors hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
          >
            <StorageUsage storage={data.storage} compact />
          </button>
        </>
      )}

      <MenuSeparator />

      <MenuSection label="Account">
        <MenuItem icon={icons.contacts.card} label="Profile" onClick={() => onGo("profile")} navigates />
        <MenuItem
          icon={icons.account.security}
          label="Security"
          onClick={() => onGo("security")}
          navigates
        />
        <MenuItem
          icon={icons.account.devices}
          label="Devices & sessions"
          trailing={data ? String(data.security.activeSessions) : undefined}
          onClick={() => onGo("devices")}
          navigates
        />
        <MenuItem icon={icons.account.privacy} label="Privacy" onClick={() => onGo("privacy")} navigates />
      </MenuSection>

      <MenuSeparator />

      <MenuSection label="Preferences">
        <MenuItem icon={icons.settings.theme} label="Appearance" onClick={onAppearance} navigates />
        <MenuItem
          icon={icons.settings.notifications}
          label="Notifications"
          onClick={() => onGo("notifications")}
          navigates
        />
        <MenuItem icon={icons.settings.shortcuts} label="Keyboard shortcuts" onClick={onShortcuts} />
      </MenuSection>

      {data && (
        <>
          <MenuSeparator />
          <MenuSection label="Not available yet">
            <UnavailableRow
              icon={icons.chrome.add}
              label="Add another account"
              reason={data.unavailable.accountSwitching}
            />
            <UnavailableRow
              icon={icons.account.connectedApps}
              label="Connected apps"
              reason={data.unavailable.connectedApps}
            />
            <UnavailableRow
              icon={icons.account.developer}
              label="API access"
              reason={data.unavailable.apiKeys}
            />
          </MenuSection>
        </>
      )}

      <MenuSeparator />

      <div className="pb-1">
        <MenuItem
          icon={icons.chrome.signOut}
          label="Sign out"
          onClick={onSignOut}
          busy={signingOut}
          danger
        />
      </div>
    </>
  );
}

/** Matches the security block's height so the panel does not jump when it loads. */
function SecuritySkeleton() {
  return (
    <div className="flex min-h-11 animate-pulse items-center gap-2.5 rounded-lg bg-surface-sunken px-3 py-2">
      <div className="h-5 w-5 shrink-0 rounded-full bg-border" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-32 rounded bg-border" />
        <div className="h-2.5 w-44 rounded bg-border-muted" />
      </div>
    </div>
  );
}

// ── Appearance sub-panel ───────────────────────────────────────────────────

function AppearancePanel({
  theme,
  themeOptions,
  onThemeChange,
  density,
  densityOptions,
  onDensityChange,
  onBack,
}: {
  theme: "light" | "dark";
  themeOptions: { id: "light" | "dark"; label: string; icon: typeof icons.settings.light }[];
  onThemeChange: (theme: "light" | "dark") => void;
  density: "compact" | "comfortable" | "spacious";
  densityOptions: { id: "compact" | "comfortable" | "spacious"; label: string; icon: typeof icons.settings.light }[];
  onDensityChange: (density: "compact" | "comfortable" | "spacious") => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={onBack}
          className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-ink hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
        >
          <Icon icon={icons.chrome.chevronLeft} size="md" className="text-ink-secondary" />
          <span className="font-medium">Appearance</span>
        </button>
      </div>

      <MenuSection label="Theme">
        {themeOptions.map((option) => (
          <MenuItem
            key={option.id}
            icon={option.icon}
            label={option.label}
            onClick={() => onThemeChange(option.id)}
            trailing={theme === option.id ? "✓" : undefined}
          />
        ))}
        <UnavailableRow
          icon={icons.settings.system}
          label="Match system"
          reason="The theme is applied per session and is not persisted to your account yet."
        />
      </MenuSection>

      <MenuSeparator />

      <MenuSection label="Density">
        {densityOptions.map((option) => (
          <MenuItem
            key={option.id}
            icon={option.icon}
            label={option.label}
            onClick={() => onDensityChange(option.id)}
            trailing={density === option.id ? "✓" : undefined}
          />
        ))}
      </MenuSection>
    </>
  );
}
