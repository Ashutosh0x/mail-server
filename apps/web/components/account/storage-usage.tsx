"use client";

import { cn } from "@mailserver/ui";
import { formatBytes } from "@/lib/format";
import type { StorageUsage as StorageUsageData } from "@/lib/account-types";

/**
 * Storage usage.
 *
 * Every number is summed from the rows that exist, per request — not read from
 * the denormalised `users.used_bytes` counter, which can drift. A quota bar
 * that disagrees with what the user can actually store is worse than no bar.
 *
 * A brand-new account reads "0 B of 15 GB used" rather than hiding the section,
 * because zero is the true answer and the user still wants to know their quota.
 */
export function StorageUsage({
  storage,
  compact,
}: {
  storage: StorageUsageData;
  compact?: boolean;
}) {
  // Warn only near the ceiling. Colouring the bar early trains people to
  // ignore it.
  const tone =
    storage.percentUsed >= 95 ? "danger" : storage.percentUsed >= 80 ? "warning" : "primary";

  return (
    <div className={compact ? "px-3 py-2" : ""}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className={cn("font-medium text-ink", compact ? "text-xs" : "text-sm")}>Storage</span>
        <span className={cn("tabular-nums text-ink-secondary", compact ? "text-xs" : "text-sm")}>
          {formatBytes(storage.usedBytes)} of {formatBytes(storage.quotaBytes)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(storage.percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Storage used"
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-primary"
          )}
          // A non-zero usage that rounds to 0% should still be visible.
          style={{
            width: storage.usedBytes > 0 ? `${Math.max(1, storage.percentUsed)}%` : "0%",
          }}
        />
      </div>

      {!compact && (
        <ul className="mt-3 space-y-1.5">
          {storage.breakdown.map((part) => (
            <li key={part.id} className="flex items-baseline justify-between text-sm">
              <span className="text-ink-secondary">{part.label}</span>
              <span className="tabular-nums text-ink">{formatBytes(part.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
