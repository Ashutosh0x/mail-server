"use client";

import { Icon, cn, icons } from "@mailserver/ui";
import type { SecurityPosture } from "@/lib/account-types";

/**
 * The compact security indicator at the top of the profile menu.
 *
 * Two states, and the wording is load-bearing. "Account protected" is a claim,
 * so it requires every check that CAN be satisfied to be satisfied. Anything
 * less says "Improve account security" and names what is missing — a green tick
 * next to an unprotected account is the one outcome worth engineering against.
 *
 * Checks with no implementation behind them are excluded from the score
 * entirely rather than counted as failures, because telling someone to enable
 * a control that does not exist wastes their time and erodes the indicator.
 */
export function SecurityStatus({
  posture,
  onOpen,
}: {
  posture: SecurityPosture;
  onOpen: () => void;
}) {
  const missing = posture.checks.filter((check) => check.state === "missing");

  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
        "focus:outline-none focus-visible:outline-none",
        posture.protected
          ? "bg-success-muted hover:brightness-95 focus:brightness-95"
          : "bg-warning-muted hover:brightness-95 focus:brightness-95"
      )}
    >
      <Icon
        icon={posture.protected ? icons.account.security : icons.account.securityAlert}
        size="md"
        className={cn("shrink-0", posture.protected ? "text-success-ink" : "text-warning-ink")}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-medium",
            posture.protected ? "text-success-ink" : "text-warning-ink"
          )}
        >
          {posture.protected ? "Account protected" : "Improve account security"}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            posture.protected ? "text-success-ink/80" : "text-warning-ink/80"
          )}
        >
          {posture.protected
            ? `${posture.satisfied} of ${posture.applicable} checks passing`
            : missing.length > 0
              ? `Missing: ${missing.map((check) => check.label).join(", ")}`
              : "Review your security settings"}
        </span>
      </span>
      <Icon
        icon={icons.account.manage}
        size="sm"
        className={cn("shrink-0", posture.protected ? "text-success-ink/70" : "text-warning-ink/70")}
      />
    </button>
  );
}

/** The full checklist, used by the Security Center rather than the menu. */
export function SecurityChecklist({ posture }: { posture: SecurityPosture }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink">Account protection</span>
          <span className="text-sm tabular-nums text-ink-secondary">{posture.score}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={posture.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Account protection score"
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              posture.protected ? "bg-success" : "bg-warning"
            )}
            style={{ width: `${posture.score}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">
          {posture.satisfied} of {posture.applicable} applicable checks. Controls with no
          implementation are excluded rather than counted against you.
        </p>
      </div>

      <ul className="space-y-1">
        {posture.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2.5 py-1">
            <Icon
              icon={
                check.state === "satisfied"
                  ? icons.status.success
                  : check.state === "missing"
                    ? icons.status.warning
                    : icons.status.info
              }
              size="sm"
              className={cn(
                "mt-0.5 shrink-0",
                check.state === "satisfied"
                  ? "text-success"
                  : check.state === "missing"
                    ? "text-warning"
                    : "text-ink-muted"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm text-ink">
                {check.label}
                {check.state === "unavailable" && (
                  <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                    Not built
                  </span>
                )}
              </span>
              <span className="block text-xs text-ink-muted">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
