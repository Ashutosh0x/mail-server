"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { duration, easing } from "@mailserver/ui";
import { useMotion } from "@/lib/motion-preference";

/**
 * FLIP layout animation for a list.
 *
 * When a message is archived the rows below should close the gap by sliding,
 * not by teleporting. FLIP is how that is done without animating layout
 * properties: measure First, let React paint the Last state, Invert the delta
 * with a transform, then Play it back to zero. Only `transform` animates, so
 * the whole thing stays on the compositor.
 *
 * Animating `top`/`height` instead would force layout on every frame for every
 * remaining row — the exact thing that makes a long list stutter.
 *
 * Rows that were not on screen before are skipped rather than faded in: a list
 * that animates everything on every change is noise, and virtualised rows
 * enter and leave constantly.
 */
export function useFlipList<T extends string>(keys: readonly T[]) {
  const positions = useRef(new Map<T, DOMRect>());
  const nodes = useRef(new Map<T, HTMLElement>());
  const { reduced } = useMotion();

  /** Ref callback for each row, keyed by a stable id. */
  const register = useCallback((key: T) => {
    return (node: HTMLElement | null) => {
      if (node) nodes.current.set(key, node);
      else nodes.current.delete(key);
    };
  }, []);

  /**
   * Call immediately BEFORE the state change that reorders the list, while the
   * old layout is still on screen.
   */
  const measure = useCallback(() => {
    if (reduced) return;
    positions.current.clear();
    for (const [key, node] of nodes.current) {
      positions.current.set(key, node.getBoundingClientRect());
    }
  }, [reduced]);

  // Runs after React has committed the new layout but before the browser
  // paints, which is the only window where inverting is invisible.
  useLayoutEffect(() => {
    if (reduced || positions.current.size === 0) return;

    for (const [key, node] of nodes.current) {
      const previous = positions.current.get(key);
      if (!previous) continue; // New row: no previous position to travel from.

      const next = node.getBoundingClientRect();
      const deltaY = previous.top - next.top;
      // Sub-pixel movement is not worth an animation.
      if (Math.abs(deltaY) < 1) continue;

      node.animate(
        [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
        { duration: duration.normal, easing: easing.standard }
      );
    }

    positions.current.clear();
  }, [keys, reduced]);

  return { register, measure };
}
