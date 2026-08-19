"use client";

import { forwardRef } from "react";
import { Icon, cn, icons, type LucideIcon } from "@mailserver/ui";

/**
 * The building blocks of the profile menu.
 *
 * Split out because the menu, the security panel and the account page all need
 * the same row, and three copies of a focus ring is how a design system starts
 * disagreeing with itself.
 */

/** A section label. `role="presentation"` because the group carries the name. */
export function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="py-1">
      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  /** Second line. Also where an "unavailable" reason goes. */
  detail?: string;
  onClick?: () => void;
  /** Renders a chevron, signalling that activating opens another surface. */
  navigates?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Right-aligned status text, e.g. a count or a value. */
  trailing?: string;
  busy?: boolean;
}

/**
 * One row.
 *
 * `tabIndex={-1}` throughout: the menu is a roving-focus composite, so Tab
 * moves out of it and Arrow keys move within it. That is what a menu is
 * supposed to do, and it is why focus is managed by the parent rather than by
 * the browser's natural order.
 *
 * Touch target is 44px minimum via `min-h-11`, which is the mobile requirement
 * and does no harm on a pointer device.
 */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { icon, label, detail, onClick, navigates, disabled, danger, trailing, busy },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled || busy}
      onClick={onClick}
      aria-describedby={detail ? undefined : undefined}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
        "focus:outline-none focus-visible:outline-none",
        disabled
          ? "cursor-not-allowed text-ink-muted"
          : danger
            ? "text-danger hover:bg-danger-muted focus:bg-danger-muted"
            : "text-ink hover:bg-surface-sunken focus:bg-surface-sunken"
      )}
    >
      <Icon
        icon={busy ? icons.status.loading : icon}
        size="md"
        className={cn(
          "shrink-0",
          busy && "animate-spin",
          disabled ? "text-ink-muted" : danger ? "text-danger" : "text-ink-secondary"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-xs text-ink-muted">{detail}</span>}
      </span>
      {trailing && <span className="shrink-0 text-xs text-ink-muted">{trailing}</span>}
      {navigates && !disabled && (
        <Icon icon={icons.account.manage} size="sm" className="shrink-0 text-ink-muted" />
      )}
    </button>
  );
});

/**
 * A row for something that does not exist yet.
 *
 * Deliberately not a disabled MenuItem: a greyed-out row invites clicking and
 * explains nothing. This states the reason inline, which is the difference
 * between "coming soon" and a button that fails.
 */
export function UnavailableRow({
  icon,
  label,
  reason,
}: {
  icon: LucideIcon;
  label: string;
  reason: string;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 text-sm text-ink-muted">
      <Icon icon={icon} size="md" className="mt-0.5 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate">{label}</span>
          <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide">
            Not built
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-snug">{reason}</span>
      </span>
    </div>
  );
}
