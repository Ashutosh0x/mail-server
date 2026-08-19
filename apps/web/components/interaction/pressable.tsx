"use client";

import { forwardRef, useCallback, useState } from "react";
import { cn, duration, easing, haptics, Icon, icons, type LucideIcon } from "@mailserver/ui";
import { useMotion } from "@/lib/motion-preference";

/**
 * Press feedback primitives.
 *
 * The scale is 0.97–0.99, which sounds too small to notice and is exactly
 * right: at this size the button reads as *depressing under the finger*
 * rather than shrinking. Anything past 0.95 starts to look like a toy.
 *
 * Press state is tracked on pointer events rather than CSS `:active` because
 * `:active` sticks on touch devices after the finger lifts, and because a
 * pointer that leaves the element mid-press must release the state — dragging
 * off a button is a cancel, and it should look like one.
 */

function usePressState(disabled?: boolean) {
  const [pressed, setPressed] = useState(false);
  const { reduced } = useMotion();

  const handlers = {
    onPointerDown: useCallback(() => {
      if (!disabled) setPressed(true);
    }, [disabled]),
    onPointerUp: useCallback(() => setPressed(false), []),
    // Covers dragging off the element and the pointer being cancelled by a
    // scroll taking over.
    onPointerLeave: useCallback(() => setPressed(false), []),
    onPointerCancel: useCallback(() => setPressed(false), []),
  };

  return { pressed: pressed && !disabled && !reduced, handlers };
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export interface PressableProps extends ButtonProps {
  /**
   * Haptic to fire on press. `null` for none.
   * Disabled controls never fire one — feedback for a rejected action is
   * worse than silence.
   */
  haptic?: "tap" | "selection" | "impact" | null;
  /** How far to depress. Smaller for large surfaces, which travel further. */
  scale?: number;
}

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(function Pressable(
  { haptic = "tap", scale = 0.97, className, children, onPointerDown, disabled, ...rest },
  ref
) {
  const { pressed, handlers } = usePressState(disabled);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      handlers.onPointerDown();
      if (!disabled && haptic) haptics[haptic]();
      onPointerDown?.(event);
    },
    [disabled, haptic, handlers, onPointerDown]
  );

  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerLeave}
      onPointerCancel={handlers.onPointerCancel}
      className={cn("touch-manipulation select-none", className)}
      style={{
        transform: pressed ? `scale(${scale})` : "scale(1)",
        // Press must feel immediate; release can be slightly softer.
        transition: `transform ${pressed ? duration.instant : duration.fast}ms ${easing.standard}`,
        ...rest.style,
      }}
    >
      {children}
    </button>
  );
});

/**
 * A button with a loading state that cannot be double-submitted.
 *
 * `busy` disables the control and swaps the icon for a spinner. The width is
 * held steady by keeping the label mounted and hiding it, so the button does
 * not resize mid-action and move whatever is next to it.
 */
export const AnimatedButton = forwardRef<
  HTMLButtonElement,
  PressableProps & { busy?: boolean; icon?: LucideIcon; busyLabel?: string }
>(function AnimatedButton({ busy, icon, busyLabel, children, disabled, className, ...rest }, ref) {
  return (
    <Pressable
      ref={ref}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn("relative inline-flex items-center justify-center gap-2", className)}
    >
      {busy && (
        <Icon icon={icons.status.loading} size="sm" className="absolute left-3 animate-spin" />
      )}
      {icon && !busy && <Icon icon={icon} size="sm" />}
      <span className={cn(busy && "opacity-70")}>{busy && busyLabel ? busyLabel : children}</span>
    </Pressable>
  );
});

/**
 * An icon-only button.
 *
 * Scales less than a text button: a small square depressing by 3% reads as a
 * glitch, while 1.5% reads as a press.
 */
export const AnimatedIconButton = forwardRef<
  HTMLButtonElement,
  PressableProps & { icon: LucideIcon; label: string; active?: boolean }
>(function AnimatedIconButton({ icon, label, active, className, ...rest }, ref) {
  return (
    <Pressable
      ref={ref}
      scale={0.985}
      {...rest}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "rounded-md p-1.5",
        active ? "bg-primary-muted text-primary" : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
        className
      )}
    >
      <Icon icon={icon} size="md" />
    </Pressable>
  );
});
