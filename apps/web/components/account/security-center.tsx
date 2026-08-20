"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon, cn, haptics, icons, type LucideIcon } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import type { AuditEntry, SecurityCheck, SecurityPosture, SessionRecord } from "@/lib/account-types";
import {
  categorise,
  describeEventDevice,
  formatEventTime,
  groupByDay,
  presentEvent,
  type EventCategory,
} from "@/lib/security-events";
import { useMotion } from "@/lib/motion-preference";
import { PasskeyManager } from "./passkey-manager";

/**
 * The Security Center.
 *
 * Everything here is computed from `GET /api/account/security`. The score in
 * particular is never recomputed on the client — one scoring model, on the
 * server, or the number in the UI eventually disagrees with the number in an
 * audit.
 *
 * The wording distinction that runs through the whole screen: a control that
 * has NO IMPLEMENTATION is not a security failure the user caused. It reads
 * "Coming soon" and is excluded from the score, rather than sitting in red
 * next to things they genuinely should fix. Conversely nothing here claims a
 * protection exists when it does not.
 */

// ── Status vocabulary ──────────────────────────────────────────────────────

type Status = "protected" | "attention" | "critical" | "unavailable";

const STATUS: Record<Status, { label: string; icon: LucideIcon; className: string; dot: string }> = {
  protected: {
    label: "Protected",
    icon: icons.status.success,
    className: "bg-success-muted text-success-ink",
    dot: "bg-success",
  },
  attention: {
    label: "Needs attention",
    icon: icons.status.warning,
    className: "bg-warning-muted text-warning-ink",
    dot: "bg-warning",
  },
  critical: {
    label: "Action required",
    icon: icons.status.error,
    className: "bg-danger-muted text-danger-ink",
    dot: "bg-danger",
  },
  unavailable: {
    // Never red. A feature nobody has built is not the user's failing.
    label: "Coming soon",
    icon: icons.chrome.timestamp,
    className: "bg-surface-sunken text-ink-secondary",
    dot: "bg-border-strong",
  },
};

function statusFor(check: SecurityCheck): Status {
  if (check.state === "unavailable") return "unavailable";
  if (check.state === "satisfied") return "protected";
  // A password that is missing entirely is critical; an absent optional
  // factor is not.
  return check.id === "password" ? "critical" : "attention";
}

function StatusBadge({ status }: { status: Status }) {
  const tone = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone.className
      )}
    >
      {/* Icon plus text, never colour alone — WCAG 1.4.1. */}
      <Icon icon={tone.icon} size="sm" />
      {tone.label}
    </span>
  );
}

// ── User-facing copy for each check ────────────────────────────────────────

/**
 * The backend's `detail` is written for an engineer ("Registration needs
 * WebAuthn, which is not built yet"). These are the same facts for a person
 * who does not know what WebAuthn is — without softening the central point,
 * which is that the capability does not exist.
 *
 * The technical sentence is kept and shown under "Technical details", because
 * hiding it entirely would be its own kind of dishonesty.
 */
const CHECK_COPY: Record<string, { title: string; blurb: string; learn: string }> = {
  password: {
    title: "Password",
    blurb: "Your password is securely protected.",
    learn:
      "Stored as a scrypt hash with per-account salt, never as recoverable text. Nobody, including an administrator, can read it back.",
  },
  passkey: {
    title: "Passkeys",
    blurb: "Sign in with your fingerprint, face or device PIN.",
    learn:
      "Passkeys replace a password with a key held by your device and unlocked by your fingerprint, face or PIN. The private key never leaves the device, and a passkey only works on the site it was created for, so it cannot be phished or reused.",
  },
  mfa: {
    title: "Two-factor authentication",
    blurb: "Setup isn't available yet.",
    learn:
      "A second factor means a stolen password alone is not enough to sign in. Enrolment with an authenticator app is not currently available.",
  },
  recovery: {
    title: "Recovery methods",
    blurb: "Not available yet.",
    learn:
      "Recovery codes let you back into an account when you lose your other factors. Storage for them is not currently available.",
  },
};

// ── The page ───────────────────────────────────────────────────────────────

export function SecurityCenter({
  posture,
  sessions,
  activity,
  onRefresh,
  refreshing,
}: {
  posture: SecurityPosture;
  sessions: SessionRecord[];
  activity: AuditEntry[];
  onRefresh: () => Promise<void>;
  refreshing: boolean;
}) {
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Security</h2>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Protect your account and monitor important security activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-sunken disabled:opacity-60 pointer-coarse:min-h-11 pointer-coarse:px-3.5"
        >
          <span className="inline-flex items-center gap-1.5">
            <Icon
              icon={icons.account.refresh}
              size="sm"
              className={cn(refreshing && "animate-spin")}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </span>
        </button>
      </div>

      <SecurityOverview posture={posture} />
      <AuthenticationSection posture={posture} onChanged={onRefresh} />
      <RecommendedSteps posture={posture} />
      <SessionsSection sessions={sessions} onChanged={onRefresh} />
      <ActivitySection activity={activity} onOpen={setDetail} />

      {detail && <ActivityDetail entry={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

// ── Overview hero ──────────────────────────────────────────────────────────

function SecurityOverview({ posture }: { posture: SecurityPosture }) {
  const [explaining, setExplaining] = useState(false);
  const { reduced } = useMotion();

  const status: Status = posture.protected
    ? "protected"
    : posture.checks.some((c) => c.state === "missing" && c.id === "password")
      ? "critical"
      : "attention";

  const missing = posture.checks.filter((c) => c.state === "missing");
  const unavailable = posture.checks.filter((c) => c.state === "unavailable");

  // Written from real state, never a fixed sentence.
  const summary = posture.protected
    ? "Every protection available on this account is active."
    : missing.length > 0
      ? `Your password is protecting this account. ${missing.length === 1 ? "One further protection is" : `${missing.length} further protections are`} not configured yet.`
      : "Review the protections below.";

  const circumference = 2 * Math.PI * 42;

  return (
    <section className="mb-4 rounded-xl border border-border bg-surface p-5" aria-labelledby="security-status">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="relative shrink-0" role="img" aria-label={`${posture.score}% of applicable protections active`}>
          <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
            <circle cx="52" cy="52" r="42" fill="none" strokeWidth="8" className="stroke-surface-sunken" />
            <circle
              cx="52"
              cy="52"
              r="42"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              transform="rotate(-90 52 52)"
              className={cn(
                status === "protected" ? "stroke-success" : status === "critical" ? "stroke-danger" : "stroke-warning"
              )}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - posture.score / 100)}
              style={
                reduced
                  ? undefined
                  : { transition: "stroke-dashoffset 600ms cubic-bezier(0.2, 0, 0, 1)" }
              }
            />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-ink">{posture.score}%</span>
          </span>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h3 id="security-status" className="sr-only">
            Security status
          </h3>
          <div className="flex justify-center sm:justify-start">
            <StatusBadge status={status} />
          </div>
          <p className="mt-2 text-sm text-ink">{summary}</p>
          <p className="mt-1 text-sm text-ink-secondary">
            {posture.satisfied} of {posture.applicable} recommended protections active
            {unavailable.length > 0 && ` · ${unavailable.length} not available yet`}
          </p>

          <button
            type="button"
            onClick={() => setExplaining((v) => !v)}
            aria-expanded={explaining}
            className="mt-2 -my-3.5 inline-flex items-center gap-1 py-3.5 text-xs font-medium text-primary hover:underline"
          >
            <Icon icon={icons.chrome.helpTooltip} size="sm" />
            How is this calculated?
          </button>

          {explaining && (
            <div className="mt-2 rounded-lg bg-surface-sunken p-3 text-left text-xs leading-relaxed text-ink-secondary">
              <p>
                The score is the number of active protections divided by the number that
                can currently be turned on — {posture.satisfied} ÷ {posture.applicable}.
              </p>
              <p className="mt-1.5">
                Protections that have not been built yet are left out of the total
                entirely. Counting them against you would mean showing a permanently
                low score for something you have no way to fix.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Authentication checks ──────────────────────────────────────────────────

function AuthenticationSection({
  posture,
  onChanged,
}: {
  posture: SecurityPosture;
  onChanged: () => Promise<void>;
}) {
  return (
    <section className="mb-4" aria-labelledby="authentication-heading">
      <h3 id="authentication-heading" className="mb-2 text-sm font-semibold text-ink">
        Authentication
      </h3>
      <ul className="space-y-2">
        {posture.checks.map((check) => (
          <li key={check.id}>
            {/* Passkeys have a real enrolment flow now, so the card is
                replaced by the working control rather than a status line. */}
            {check.id === "passkey" ? <PasskeyManager onChanged={onChanged} /> : <CheckCard check={check} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckCard({ check }: { check: SecurityCheck }) {
  const [open, setOpen] = useState(false);
  const status = statusFor(check);
  const copy = CHECK_COPY[check.id];

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{copy?.title ?? check.label}</div>
          <p className="mt-0.5 text-sm text-ink-secondary">{copy?.blurb ?? check.detail}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            haptics.selection();
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className="-my-3.5 py-3.5 text-xs font-medium text-primary hover:underline"
        >
          {open ? "Hide details" : "Learn more"}
        </button>
        {/* Deliberately no Enable button for anything unavailable. A control
            that opens a dialog and then apologises is worse than its absence.
            When the backend gains the capability, the card gains the action. */}
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-surface-sunken p-3 text-xs leading-relaxed text-ink-secondary">
          <p>{copy?.learn ?? check.detail}</p>
          <details>
            <summary className="cursor-pointer font-medium text-ink-secondary">
              Technical details
            </summary>
            <p className="mt-1.5 font-mono text-[11px] text-ink-muted">
              {check.id} · {check.state} — {check.detail}
            </p>
          </details>
        </div>
      )}
    </div>
  );
}

// ── Recommendations ────────────────────────────────────────────────────────

/**
 * Checks whose enrolment flow actually exists.
 *
 * Deliberately separate from the security posture. "This account lacks a
 * passkey" and "you can add a passkey" are different questions: the first is
 * about the account and rightly lowers the score, the second is about whether
 * we built the flow. Deriving one from the other told the user a protection
 * was "Available now" while the card above it said it was not.
 *
 * `passkey` is here because WebAuthn registration now works. Adding an id is
 * the single edit that turns a step actionable when its backend lands.
 */
const ENROLMENT_AVAILABLE = new Set<string>(["passkey"]);

function RecommendedSteps({ posture }: { posture: SecurityPosture }) {
  const steps = posture.checks.filter((c) => c.state !== "satisfied");
  if (steps.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-border bg-surface p-4" aria-labelledby="next-steps">
      <h3 id="next-steps" className="mb-2 text-sm font-semibold text-ink">
        Recommended next steps
      </h3>
      <ol className="space-y-2">
        {steps.map((check, index) => {
          const copy = CHECK_COPY[check.id];
          const actionable = ENROLMENT_AVAILABLE.has(check.id);
          return (
            <li key={check.id} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold tabular-nums text-ink-secondary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-ink">
                  {check.id === "password" ? "Set a password" : `Set up ${copy?.title.toLowerCase() ?? check.label.toLowerCase()}`}
                </span>
                <span className="ml-2 text-xs text-ink-muted">
                  {actionable ? "Available now" : "Coming soon"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-ink-muted">
        These become actionable automatically once the underlying capability ships.
      </p>
    </section>
  );
}

// ── Sessions ───────────────────────────────────────────────────────────────

function SessionsSection({
  sessions,
  onChanged,
}: {
  sessions: SessionRecord[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const others = sessions.filter((s) => !s.current);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(id);
      setError(null);
      try {
        haptics.impact();
        await api.revokeSession(id);
        await onChanged();
        haptics.success();
      } catch (cause) {
        haptics.error();
        setError(cause instanceof ApiError ? cause.message : "Could not sign that device out.");
      } finally {
        setBusy(null);
      }
    },
    [onChanged]
  );

  const revokeOthers = useCallback(async () => {
    setBusy("all");
    setError(null);
    try {
      await api.revokeOtherSessions();
      await onChanged();
      haptics.success();
      setConfirming(false);
    } catch (cause) {
      haptics.error();
      setError(cause instanceof ApiError ? cause.message : "Could not sign the other devices out.");
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  return (
    <section className="mb-4" aria-labelledby="sessions-heading">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 id="sessions-heading" className="text-sm font-semibold text-ink">
          Devices &amp; sessions
        </h3>
        <span className="text-xs text-ink-muted">
          {sessions.length} active {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>

      {error && (
        <div role="alert" className="mb-2 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {sessions.map((session) => (
          <li key={session.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
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
                <dl className="mt-1 space-y-0.5 text-xs text-ink-muted">
                  <div className="flex gap-1.5">
                    <dt>IP address:</dt>
                    <dd className="font-mono">{session.ipAddress ?? "Not available"}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>Last active:</dt>
                    <dd>
                      {session.current
                        ? "Active now"
                        : session.lastSeenAt
                          ? new Date(session.lastSeenAt).toLocaleString()
                          : "Not available"}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>Signed in:</dt>
                    <dd>{new Date(session.createdAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </div>

              {session.current ? (
                <span className="shrink-0 text-xs text-ink-muted">Current session</span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void revoke(session.id)}
                  className="min-h-11 shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  {busy === session.id ? "Signing out…" : "Revoke"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setConfirming(true)}
          className="mt-3 min-h-11 rounded-lg border border-danger px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-muted disabled:opacity-50"
        >
          Sign out of all other devices
        </button>
      )}

      <p className="mt-2 text-xs text-ink-muted">
        Approximate location is not shown — there is no geolocation lookup, and a guessed
        city is worse than none.
      </p>

      {confirming && (
        <ConfirmDialog
          title="Sign out of other devices?"
          body={`This will end ${others.length} other ${others.length === 1 ? "session" : "sessions"}. Your current session will remain active.`}
          confirmLabel="Sign out other devices"
          busy={busy === "all"}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void revokeOthers()}
        />
      )}
    </section>
  );
}

// ── Activity timeline ──────────────────────────────────────────────────────

const FILTERS: { id: EventCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "signin", label: "Sign-ins" },
  { id: "security", label: "Security" },
  { id: "profile", label: "Profile" },
  { id: "mail", label: "Mail" },
];

function ActivitySection({
  activity,
  onOpen,
}: {
  activity: AuditEntry[];
  onOpen: (entry: AuditEntry) => void;
}) {
  const [filter, setFilter] = useState<EventCategory>("all");

  const filtered = useMemo(
    () => (filter === "all" ? activity : activity.filter((e) => categorise(e.action) === filter)),
    [activity, filter]
  );
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <section aria-labelledby="activity-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-heading" className="text-sm font-semibold text-ink">
          Recent security activity
        </h3>
        <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                // Finger-sized where a finger is used; compact for a mouse.
                "pointer-coarse:min-h-11 pointer-coarse:px-3.5",
                filter === option.id
                  ? "bg-primary-muted text-primary"
                  : "text-ink-secondary hover:bg-surface-sunken"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        {groups.length === 0 ? (
          <div className="py-6 text-center">
            <Icon icon={icons.security.auditLog} size="lg" className="mx-auto text-ink-disabled" />
            <p className="mt-2 text-sm font-medium text-ink-secondary">
              {filter === "all" ? "No recent security activity" : "No activity of this kind"}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Important account security events will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                  {group.label}
                </h4>
                <ul className="space-y-0">
                  {group.entries.map((entry, index) => (
                    <TimelineRow
                      key={entry.id}
                      entry={entry}
                      last={index === group.entries.length - 1}
                      onOpen={() => onOpen(entry)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TimelineRow({
  entry,
  last,
  onOpen,
}: {
  entry: AuditEntry;
  last: boolean;
  onOpen: () => void;
}) {
  const shown = presentEvent(entry.action);
  const device = describeEventDevice(entry);

  return (
    <li className="relative">
      {/* The connecting rail, stopping at the last row of the group. */}
      {!last && <span aria-hidden="true" className="absolute left-[7px] top-6 h-full w-px bg-border" />}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 w-full items-start gap-3 rounded-lg py-2 pl-0 pr-2 text-left transition-colors hover:bg-surface-sunken"
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-[15px] shrink-0 rounded-full border-2 border-surface",
            shown.tone === "attention" ? "bg-warning" : shown.tone === "positive" ? "bg-success" : "bg-border-strong"
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Icon icon={shown.icon} size="sm" className="shrink-0 text-ink-secondary" />
            <span className="truncate text-sm text-ink">{shown.label}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">
            {device ?? "Device not recorded"}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {formatEventTime(entry.createdAt)}
        </span>
      </button>
    </li>
  );
}

function ActivityDetail({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const shown = presentEvent(entry.action);
  const device = describeEventDevice(entry);

  // Only fields that genuinely exist. "Not available" where a value was never
  // recorded — never an inferred location or a guessed device.
  const fields: { label: string; value: string }[] = [
    { label: "Event", value: shown.label },
    { label: "Time", value: new Date(entry.createdAt).toLocaleString() },
    { label: "Device", value: device ?? "Not available" },
    { label: "Browser", value: entry.browser ?? "Not available" },
    { label: "Operating system", value: entry.os ?? "Not available" },
    { label: "IP address", value: entry.ipAddress ?? "Not available" },
    { label: "Approximate location", value: "Not available" },
    { label: "Severity", value: entry.severity },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface-raised p-5 shadow-lg sm:max-w-md sm:rounded-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="flex items-center gap-2">
            <Icon icon={shown.icon} size="md" className="text-ink-secondary" />
            <h2 id="event-detail-title" className="text-base font-semibold text-ink">
              {shown.label}
            </h2>
          </span>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
          >
            <Icon icon={icons.chrome.close} size="md" label="Close" />
          </button>
        </div>

        {shown.description && <p className="mb-3 text-sm text-ink-secondary">{shown.description}</p>}

        <dl className="space-y-2 text-sm">
          {fields.map((field) => (
            <div key={field.label} className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-ink-secondary">{field.label}</dt>
              <dd
                className={cn(
                  "min-w-0 truncate text-right",
                  field.value === "Not available" ? "text-ink-muted" : "text-ink"
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-ink-secondary">
            Diagnostics
          </summary>
          <dl className="mt-2 space-y-1 font-mono text-[11px] text-ink-muted">
            <div className="flex justify-between gap-3">
              <dt>Event ID</dt>
              <dd className="truncate">{entry.id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Event type</dt>
              {/* The raw code, never lost in translation. */}
              <dd className="truncate">{entry.action}</dd>
            </div>
          </dl>
        </details>
      </div>
    </div>
  );
}

// ── Confirmation ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={(event) => event.stopPropagation()}
        className="w-full rounded-t-2xl border border-border bg-surface-raised p-5 shadow-lg sm:max-w-sm sm:rounded-xl"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p id="confirm-body" className="mt-1.5 text-sm text-ink-secondary">
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="min-h-11 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-danger-ink disabled:opacity-60"
          >
            {busy ? "Signing out…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
