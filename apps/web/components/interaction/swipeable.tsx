"use client";

import { useCallback, useRef, useState } from "react";
import { cn, gesture, haptics, Icon, springTiming, spring, type LucideIcon } from "@mailserver/ui";
import { useMotion } from "@/lib/motion-preference";

/**
 * Swipe-to-act on a list row.
 *
 * The three things that make swipe usable rather than infuriating, all handled
 * here so no call site has to think about them:
 *
 * 1. DIRECTIONAL LOCKING. The first few pixels decide whether this gesture is
 *    a vertical scroll or a horizontal swipe, and the loser is ignored for the
 *    rest of the gesture. Without it a diagonal drag scrolls the list *and*
 *    drags the row, and neither does what the finger meant.
 *
 * 2. ASYMMETRIC THRESHOLDS. Archive activates at 28% of the row; anything
 *    destructive needs 55%. A single threshold for both is how mail gets
 *    deleted by a sleeve.
 *
 * 3. ONE HAPTIC PER CROSSING. Crossing the threshold fires once. Moving around
 *    beyond it fires nothing. A buzz per frame is the fastest way to make
 *    someone turn feedback off.
 *
 * Touch only: `pointerType === "mouse"` is ignored, because a mouse has drag
 * and drop and a context menu, and hijacking click-drag breaks text selection.
 */

export interface SwipeAction {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Tailwind background for the revealed track. */
  className: string;
  /** Raises the activation threshold and warns on crossing. */
  destructive?: boolean;
  onAction: () => void;
}

export function Swipeable({
  left,
  right,
  disabled,
  children,
  className,
}: {
  /** Revealed by swiping RIGHT (finger moves right, action sits on the left). */
  left?: SwipeAction;
  /** Revealed by swiping LEFT. */
  right?: SwipeAction;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const { reduced } = useMotion();
  const elementRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [armed, setArmed] = useState<SwipeAction | null>(null);

  const state = useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    axis: null as "x" | "y" | null,
    hasFiredHaptic: false,
    width: 0,
  });

  const settle = useCallback(
    (to: number, onDone?: () => void) => {
      const node = elementRef.current;
      if (!node) return;
      if (reduced || to === 0) {
        // Reduced motion still needs the row to return; it just does not
        // spring while doing it.
        const timing = reduced ? { duration: 0, easing: "linear" } : springTiming(spring.snappy);
        node.animate(
          [{ transform: `translateX(${offset}px)` }, { transform: `translateX(${to}px)` }],
          { ...timing, fill: "forwards" }
        ).onfinish = () => {
          node.style.transform = `translateX(${to}px)`;
          onDone?.();
        };
      } else {
        node.animate(
          [{ transform: `translateX(${offset}px)` }, { transform: `translateX(${to}px)` }],
          { ...springTiming(spring.snappy), fill: "forwards" }
        ).onfinish = () => {
          node.style.transform = `translateX(${to}px)`;
          onDone?.();
        };
      }
      setOffset(to);
    },
    [offset, reduced]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Mouse keeps drag-and-drop, text selection and the context menu.
      if (disabled || event.pointerType === "mouse") return;
      const node = elementRef.current;
      if (!node) return;
      state.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: null,
        hasFiredHaptic: false,
        width: node.getBoundingClientRect().width,
      };
    },
    [disabled]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const s = state.current;
      if (s.pointerId !== event.pointerId) return;

      const dx = event.clientX - s.startX;
      const dy = event.clientY - s.startY;

      // Decide the axis once, on the first movement that clears the noise
      // floor, then never revisit it for this gesture.
      if (s.axis === null) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (Math.max(absX, absY) < gesture.dragActivationDistance) return;
        s.axis = absX > absY * gesture.directionLockRatio ? "x" : "y";
        if (s.axis === "y") {
          // Hand the gesture back to the scroller and stop tracking.
          s.pointerId = null;
          return;
        }
        // Only capture once we own the gesture, so a scroll is never stolen.
        elementRef.current?.setPointerCapture(event.pointerId);
      }

      if (s.axis !== "x") return;

      const action = dx > 0 ? left : right;
      if (!action) {
        setOffset(0);
        return;
      }

      // Rubber-band past the maximum so the limit is felt, not hit.
      const max = s.width * gesture.swipeMax;
      let next = dx;
      if (Math.abs(dx) > max) {
        const excess = Math.abs(dx) - max;
        next = Math.sign(dx) * (max + excess * gesture.overdragFactor);
      }

      const threshold =
        s.width *
        (action.destructive ? gesture.swipeActivateDestructive : gesture.swipeActivate);
      const past = Math.abs(next) >= threshold;

      if (past && !s.hasFiredHaptic) {
        // Exactly one, on the crossing.
        s.hasFiredHaptic = true;
        if (action.destructive) haptics.warning();
        else haptics.impact();
        setArmed(action);
      } else if (!past && s.hasFiredHaptic) {
        // Re-arm so swiping back out and in again can fire once more.
        s.hasFiredHaptic = false;
        setArmed(null);
      }

      setOffset(next);
      if (elementRef.current) {
        elementRef.current.style.transform = `translateX(${next}px)`;
      }
    },
    [left, right]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const s = state.current;
      if (s.pointerId !== event.pointerId) return;
      s.pointerId = null;

      const action = armed;
      setArmed(null);

      if (!action) {
        settle(0);
        return;
      }

      // Send the row off the way it was going, then run the action. The list
      // closing the gap is the caller's job (see useFlipList).
      const away = Math.sign(offset) * s.width;
      settle(away, () => {
        action.onAction();
        // Reset for reuse: the row may be recycled by the virtualiser.
        if (elementRef.current) elementRef.current.style.transform = "translateX(0px)";
        setOffset(0);
      });
    },
    [armed, offset, settle]
  );

  const revealed = offset > 0 ? left : offset < 0 ? right : null;
  const progress = revealed
    ? Math.min(
        1,
        Math.abs(offset) /
          (state.current.width *
            (revealed.destructive ? gesture.swipeActivateDestructive : gesture.swipeActivate) || 1)
      )
    : 0;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {revealed && (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 flex items-center px-4",
            offset > 0 ? "justify-start" : "justify-end",
            revealed.className
          )}
          style={{
            // The action strengthens as the threshold approaches, so the
            // outcome is legible before committing to it.
            opacity: 0.4 + progress * 0.6,
          }}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Icon
              icon={revealed.icon}
              size="md"
              style={{
                transform: `scale(${0.85 + progress * 0.15})`,
                transition: "transform 120ms cubic-bezier(0.2, 0, 0, 1)",
              }}
            />
            {revealed.label}
          </span>
        </div>
      )}

      <div
        ref={elementRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Lets the browser own vertical scrolling while we take horizontal
        // movement — the declarative half of directional locking.
        className="relative touch-pan-y bg-surface"
      >
        {children}
      </div>
    </div>
  );
}
