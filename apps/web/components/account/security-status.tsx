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
