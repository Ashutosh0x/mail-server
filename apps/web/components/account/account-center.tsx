"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, cn, icons, type LucideIcon } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type {
  AccountOverview,
  AuditEntry,
  Preferences,
  SecurityPosture,
  SessionRecord,
} from "@/lib/account-types";
import { Avatar } from "./avatar";
import { SecurityCenter } from "./security-center";
import { SettingsSkeleton } from "../interaction/skeleton";
import { StorageUsage } from "./storage-usage";
import { useMotion } from "@/lib/motion-preference";

/**
 * The full account center.
 *
 * Rendered as an in-app surface rather than a route, because the app is a
 * single page and the session lives in one place — adding a router here would
 * mean resolving the session twice and a flash of the auth screen on reload.
 *
 * Every section reads from the API. Where a capability has no implementation
 * the section says so and explains why, rather than showing a disabled control
 * with no explanation or, worse, one that fails when clicked.
 */

export type AccountSection =
  | "profile"
  | "appearance"
  | "security"
  | "devices"
  | "storage"
  | "privacy"
  | "notifications";

const SECTIONS: { id: AccountSection; label: string; icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", icon: icons.contacts.card },
  { id: "appearance", label: "Appearance", icon: icons.settings.theme },
  { id: "security", label: "Security", icon: icons.account.security },
  { id: "devices", label: "Devices & sessions", icon: icons.account.devices },
  { id: "storage", label: "Storage", icon: icons.account.storage },
  { id: "privacy", label: "Privacy", icon: icons.account.privacy },
  { id: "notifications", label: "Notifications", icon: icons.settings.notifications },
];

export function AccountCenter({
  section,
  onSectionChange,
  onClose,
}: {
  section: AccountSection;
  onSectionChange: (section: AccountSection) => void;
  onClose: () => void;
}) {
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
      role="dialog"
      aria-modal="true"
      aria-label="Account"
      className="fixed inset-0 z-50 flex flex-col bg-canvas"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:p-3"
        >
          <Icon icon={icons.chrome.close} size="md" label="Close account settings" />
        </button>
        <h1 className="text-base font-semibold text-ink">Account</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Horizontal scroller on mobile, sidebar on desktop. */}
        <nav
          aria-label="Account sections"
          className="shrink-0 overflow-x-auto border-b border-border bg-surface md:w-56 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r"
        >
          <ul className="flex gap-1 p-2 md:flex-col md:gap-0.5">
            {SECTIONS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  aria-current={section === item.id ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 w-full shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                    section === item.id
                      ? "bg-primary-muted font-medium text-primary"
                      : "text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                  )}
                >
                  <Icon icon={item.icon} size="md" className="shrink-0" />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
            {section === "profile" && <ProfileSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "security" && <SecuritySection />}
            {section === "devices" && <DevicesSection />}
            {section === "storage" && <StorageSection />}
            {section === "privacy" && <PrivacySection />}
            {section === "notifications" && <NotificationsSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Shared pieces ──────────────────────────────────────────────────────────

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-sm text-ink-secondary">{description}</p>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4", className)}>{children}</div>
  );
}

function NotBuilt({ title, reason }: { title: string; reason: string }) {
  return (
    <Card className="border-dashed">
      <div className="flex items-start gap-3">
        <Icon icon={icons.status.info} size="md" className="mt-0.5 shrink-0 text-ink-muted" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{title}</span>
            <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              Not built
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">{reason}</p>
        </div>
      </div>
    </Card>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
      <Icon icon={icons.status.loading} size="md" className="animate-spin" />
      Loading…
    </div>
  );
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-danger/40 bg-danger-muted">
      <p className="text-sm text-danger-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-medium text-danger-ink underline"
      >
        Try again
      </button>
    </Card>
  );
}

/** One async section's state, so each fetches and fails independently. */
function useResource<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetcher());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
    // The fetcher is defined inline at each call site; depending on it would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileSection() {
  const { data, error, loading, reload, setData } = useResource<AccountOverview>(() => api.account());
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setDisplayName(data.profile.displayName);
  }, [data]);

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const { profile } = await api.updateProfile({ displayName });
      setData({ ...data, profile });
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }, [data, displayName, setData]);

  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!data) return null;

  const { profile } = data;
  const dirty = displayName.trim() !== profile.displayName;

  return (
    <>
      <SectionHeading title="Profile" description="How you appear across Mail Server." />

      <Card className="mb-4">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} email={profile.email} size="lg" />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{profile.displayName}</div>
            <div className="truncate text-sm text-ink-secondary">{profile.email}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Avatars are generated from your name and address. Uploading an image is not built yet.
        </p>
      </Card>

      <Card className="mb-4">
        <label htmlFor="display-name" className="block text-sm font-medium text-ink">
          Display name
        </label>
        <p className="mb-2 text-xs text-ink-muted">
          Used in the From header on mail you send.
        </p>
        <input
          id="display-name"
          value={displayName}
          maxLength={120}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none"
        />
        {saveError && <p className="mt-2 text-sm text-danger">{saveError}</p>}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || saving || displayName.trim().length === 0}
            onClick={() => void save()}
            className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-ink transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <Icon icon={icons.status.success} size="sm" />
              Saved
            </span>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-medium text-ink">Account</h3>
        <dl className="space-y-2.5 text-sm">
          <Row label="Email address" value={profile.email} />
          <Row label="Account ID" value={profile.id} mono />
          <Row label="Role" value={profile.role} />
          <Row label="Status" value={profile.status} />
          <Row label="Time zone" value={profile.timezone} />
          <Row label="Language" value={profile.language} />
          <Row label="Created" value={new Date(profile.createdAt).toLocaleString()} />
          {profile.organization && <Row label="Organisation" value={profile.organization.name} />}
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          Changing your email address needs verification, which is not built yet. Role, status and
          quota are set by an administrator.
        </p>
      </Card>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-secondary">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-ink", mono && "font-mono text-xs")}>
        {value}
      </dd>
    </div>
  );
}

// ── Security ───────────────────────────────────────────────────────────────

function SecuritySection() {
  const { data, error, loading, reload } = useResource<{
    posture: SecurityPosture;
    sessions: SessionRecord[];
    activity: AuditEntry[];
  }>(() => api.security());
  const [refreshing, setRefreshing] = useState(false);

  // Background refresh: the existing content stays on screen while the new
  // data is fetched, so acting on a session does not blank the page.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  if (loading && !data) return <SecuritySkeleton />;
  if (error && !data) return <Failed message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <SecurityCenter
      posture={data.posture}
      sessions={data.sessions}
      activity={data.activity}
      onRefresh={refresh}
      refreshing={refreshing}
    />
  );
}

/** Mirrors the real layout, so nothing shifts when the data lands. */
function SecuritySkeleton() {
  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-ink">Security</h2>
        <p className="mt-0.5 text-sm text-ink-secondary">
          Protect your account and monitor important security activity.
        </p>
      </div>
      <div className="mb-4 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="size-[104px] shrink-0 animate-pulse rounded-full bg-surface-sunken" />
          <div className="w-full flex-1 space-y-2">
            <div className="h-6 w-32 animate-pulse rounded-full bg-surface-sunken" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-sunken" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-sunken" />
          </div>
        </div>
      </div>
      <SettingsSkeleton rows={4} />
    </>
  );
}
// ── Devices ────────────────────────────────────────────────────────────────

function DevicesSection() {
  const { data, error, loading, reload } = useResource<{ sessions: SessionRecord[] }>(() =>
    api.sessions()
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(id);
      setActionError(null);
      try {
        await api.revokeSession(id);
        await reload();
      } catch (cause) {
        setActionError(cause instanceof ApiError ? cause.message : "Could not sign that device out.");
      } finally {
        setBusy(null);
      }
    },
    [reload]
  );

  const revokeOthers = useCallback(async () => {
    setBusy("all");
    setActionError(null);
    try {
      await api.revokeOtherSessions();
      await reload();
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Could not sign the other devices out.");
    } finally {
      setBusy(null);
    }
  }, [reload]);

  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!data) return null;

  const others = data.sessions.filter((session) => !session.current);

  return (
    <>
      <SectionHeading
        title="Devices & sessions"
        description="Everywhere this account is currently signed in."
      />

      {actionError && (
        <div className="mb-4 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
          {actionError}
        </div>
      )}

      <ul className="mb-4 space-y-2">
        {data.sessions.map((session) => (
          <li key={session.id}>
            <Card className="flex items-start gap-3">
              <Icon
                icon={
                  session.deviceType === "mobile"
                    ? icons.account.deviceMobile
                    : session.deviceType === "tablet"
                      ? icons.account.deviceTablet
                      : session.deviceType === "unknown"
                        ? icons.account.deviceUnknown
                        : icons.account.deviceDesktop
                }
                size="md"
                className="mt-0.5 shrink-0 text-ink-secondary"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {session.browser} · {session.os}
                  </span>
                  {session.current && (
                    <span className="rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success-ink">
                      This device
                    </span>
                  )}
                </div>
                <div className="mt-0.5 space-y-0.5 text-xs text-ink-muted">
                  {session.ipAddress && <div className="font-mono">{session.ipAddress}</div>}
                  <div>
                    {session.lastSeenAt
                      ? `Last active ${new Date(session.lastSeenAt).toLocaleString()}`
                      : `Signed in ${new Date(session.createdAt).toLocaleString()}`}
                  </div>
                </div>
              </div>
              {!session.current && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void revoke(session.id)}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  {busy === session.id ? "Signing out…" : "Sign out"}
                </button>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void revokeOthers()}
          className="rounded-lg border border-danger px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-muted disabled:opacity-50"
        >
          {busy === "all" ? "Signing out…" : `Sign out all other devices (${others.length})`}
        </button>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Approximate location from IP address is not shown — there is no geolocation lookup, and a
        guessed city is worse than none.
      </p>
    </>
  );
}

// ── Storage ────────────────────────────────────────────────────────────────

function StorageSection() {
  const { data, error, loading, reload } = useResource(() => api.storage());

  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <>
      <SectionHeading title="Storage" description="What this account is using, summed live." />
      <Card className="mb-4">
        <StorageUsage storage={data.storage} />
        <p className="mt-3 text-xs text-ink-muted">
          {formatBytes(data.storage.quotaBytes - data.storage.usedBytes)} remaining. These totals are
          summed from your messages and attachments on every request rather than read from a cached
          counter.
        </p>
      </Card>
      <NotBuilt title="Cleanup tools" reason={data.unavailable.cleanupTools} />
    </>
  );
}

// ── Preferences: privacy and notifications ─────────────────────────────────

function usePreferences() {
  const { data, error, loading, reload, setData } = useResource<{ preferences: Preferences }>(() =>
    api.preferences()
  );
  const [saving, setSaving] = useState(false);

  const patch = useCallback(
    async (update: Parameters<typeof api.updatePreferences>[0]) => {
      setSaving(true);
      try {
        const next = await api.updatePreferences(update);
        setData(next);
      } finally {
        setSaving(false);
      }
    },
    [setData]
  );

  return { prefs: data?.preferences ?? null, error, loading, reload, patch, saving };
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        <p className="mt-0.5 text-xs leading-snug text-ink-secondary">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-primary" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform",
            checked ? "translate-x-[1.125rem]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}

function Choice<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="py-2.5">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <p className="mb-2 mt-0.5 text-xs leading-snug text-ink-secondary">{description}</p>
      <div className="space-y-1.5">
        {options.map((option) => (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
              value === option.id ? "border-primary bg-primary-muted" : "border-border hover:bg-surface-sunken"
            )}
          >
            <input
              type="radio"
              name={label}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="mt-0.5 accent-[var(--color-primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink">{option.label}</span>
              {option.hint && <span className="block text-xs text-ink-muted">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PrivacySection() {
  const { prefs, error, loading, reload, patch, saving } = usePreferences();

  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!prefs) return null;

  return (
    <>
      <SectionHeading
        title="Privacy"
        description="Defaults here are the privacy-preserving option, so doing nothing opts you into nothing."
      />

      <Card className="mb-4 divide-y divide-border">
        <Choice
          label="Remote images"
          description="Remote images tell the sender when, where and how often you opened a message."
          value={prefs.privacy.remoteImages}
          options={[
            { id: "block", label: "Block", hint: "Never load images from a remote server." },
            { id: "ask", label: "Ask each time", hint: "Show a prompt per message." },
            { id: "always", label: "Always load" },
          ]}
          onChange={(remoteImages) => void patch({ privacy: { remoteImages } })}
        />
        <Toggle
          label="Tracking protection"
          description="Strip known tracking pixels before a message is rendered."
          checked={prefs.privacy.trackingProtection}
          disabled={saving}
          onChange={(trackingProtection) => void patch({ privacy: { trackingProtection } })}
        />
        <Toggle
          label="Link protection"
          description="Warn before opening links that do not match their visible text."
          checked={prefs.privacy.linkProtection}
          disabled={saving}
          onChange={(linkProtection) => void patch({ privacy: { linkProtection } })}
        />
      </Card>

      <Card className="mb-4">
        <Choice
          label="AI processing"
          description="Whether your email content may be processed by AI features. This applies globally."
          value={prefs.privacy.aiProcessing}
          options={[
            { id: "off", label: "Off", hint: "No message content is processed by any AI feature." },
            { id: "local", label: "Local AI only", hint: "Processing stays on infrastructure you control." },
            { id: "approved", label: "Approved providers", hint: "Content may be sent to configured third parties." },
          ]}
          onChange={(aiProcessing) => void patch({ privacy: { aiProcessing } })}
        />
        <p className="mt-2 text-xs text-ink-muted">
          No AI feature exists yet, so this setting currently governs nothing. It is stored so the
          choice is already yours when one arrives.
        </p>
      </Card>

      <Card className="mb-4">
        <Toggle
          label="Telemetry"
          description="Share anonymous usage data. Off by default."
          checked={prefs.privacy.telemetry}
          disabled={saving}
          onChange={(telemetry) => void patch({ privacy: { telemetry } })}
        />
      </Card>

      <NotBuilt
        title="Data export and account deletion"
        reason="Neither is implemented. Offering a button that does not export or delete anything would be worse than its absence."
      />
    </>
  );
}

function NotificationsSection() {
  const { prefs, error, loading, reload, patch, saving } = usePreferences();

  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!prefs) return null;

  return (
    <>
      <SectionHeading title="Notifications" description="What you are told about, and where." />

      <Card className="mb-4 divide-y divide-border">
        <Toggle
          label="New mail"
          description="Notify when a message arrives."
          checked={prefs.notifications.newMail}
          disabled={saving}
          onChange={(newMail) => void patch({ notifications: { newMail } })}
        />
        <Toggle
          label="Mentions"
          description="Notify when you are mentioned directly."
          checked={prefs.notifications.mentions}
          disabled={saving}
          onChange={(mentions) => void patch({ notifications: { mentions } })}
        />
        <Toggle
          label="Desktop notifications"
          description="Show notifications outside the browser tab."
          checked={prefs.notifications.desktop}
          disabled={saving}
          onChange={(desktop) => void patch({ notifications: { desktop } })}
        />
        <Toggle
          label="Sound"
          description="Play a sound with notifications."
          checked={prefs.notifications.sound}
          disabled={saving}
          onChange={(sound) => void patch({ notifications: { sound } })}
        />
      </Card>

      <Card className="border-warning/40">
        <Toggle
          label="Security alerts"
          description="Sign-ins from new devices, credential changes, and session revocations. Kept separate from everything above so turning off notifications does not also turn these off."
          checked={prefs.notifications.securityAlerts}
          disabled={saving}
          onChange={(securityAlerts) => void patch({ notifications: { securityAlerts } })}
        />
      </Card>

      <p className="mt-3 text-xs text-ink-muted">
        These preferences are stored, but nothing delivers a notification yet — there is no mail
        transport, so no message arrives to notify you about.
      </p>
    </>
  );
}


function AppearanceSection() {
  const { prefs, error, loading, reload, patch, saving } = usePreferences();
  const { systemReduced } = useMotion();

  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!prefs) return null;

  return (
    <>
      <SectionHeading
        title="Appearance"
        description="How dense the interface is, and how much it moves."
      />

      <Card className="mb-4">
        <Choice
          label="Density"
          description="How much vertical space each message row takes."
          value={prefs.appearance.density}
          options={[
            { id: "compact" as const, label: "Compact", hint: "36px rows. Most messages on screen." },
            { id: "comfortable" as const, label: "Comfortable", hint: "56px rows." },
            { id: "spacious" as const, label: "Spacious", hint: "76px rows. Two-line previews." },
          ]}
          onChange={(density) => void patch({ appearance: { density } })}
        />
      </Card>

      <Card className="mb-4 divide-y divide-border">
        <Toggle
          label="Reduce motion"
          description={
            systemReduced
              ? "Your system already requests reduced motion, so animations are minimised regardless of this setting."
              : "Remove decorative animation. State changes still happen, they just stop moving."
          }
          checked={prefs.appearance.reducedMotion || systemReduced}
          disabled={saving || systemReduced}
          onChange={(reducedMotion) => void patch({ appearance: { reducedMotion } })}
        />
        <Toggle
          label="Message preview"
          description="Show a line of the message body in the list."
          checked={prefs.appearance.messagePreview}
          disabled={saving}
          onChange={(messagePreview) => void patch({ appearance: { messagePreview } })}
        />
      </Card>

      <NotBuilt
        title="Match system theme"
        reason="The light/dark toggle in the header applies per session and is not yet persisted to your account."
      />
    </>
  );
}
