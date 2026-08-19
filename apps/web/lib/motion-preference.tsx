"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { haptics } from "@mailserver/ui";

/**
 * One motion preference, from two sources.
 *
 * The OS setting (`prefers-reduced-motion`) and the account's own
 * `appearance.reducedMotion` both mean "calm this down". Reading them
 * separately in each component guarantees they eventually disagree, so they
 * are combined here once: either one turns motion off, and nothing can turn
 * it back on.
 *
 * `theme.css` already zeroes every CSS transition under the OS media query.
 * This context exists for the parts CSS cannot reach — Web Animations calls,
 * FLIP measurements, spring physics — and for honouring the in-app setting,
 * which no media query knows about.
 */

interface MotionPreference {
  /** True when motion should be suppressed. Check this before animating. */
  reduced: boolean;
  /** The OS-level setting, exposed so settings UI can explain the source. */
  systemReduced: boolean;
  /** The account-level setting. */
  appReduced: boolean;
  setAppReduced: (value: boolean) => void;
  /**
   * Scale a duration. Returns 0 when reduced, so a caller can pass the result
   * straight to the Web Animations API and get an instant state change rather
   * than a special-cased branch at every call site.
   */
  ms: (value: number) => number;
}

const Context = createContext<MotionPreference | null>(null);

export function MotionProvider({
  children,
  appReduced = false,
  onAppReducedChange,
}: {
  children: React.ReactNode;
  appReduced?: boolean;
  onAppReducedChange?: (value: boolean) => void;
}) {
  // Starts false and corrects after mount: the server has no media queries,
  // and guessing true would make the first paint jump for most people.
  const [systemReduced, setSystemReduced] = useState(false);
  const [localAppReduced, setLocalAppReduced] = useState(appReduced);

  useEffect(() => setLocalAppReduced(appReduced), [appReduced]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const reduced = systemReduced || localAppReduced;

  // Haptics are motion too. Someone who has asked for less movement should not
  // get a device buzzing in their hand for incidental feedback; the haptics
  // module keeps firing for real outcomes only.
  useEffect(() => {
    haptics.setEnabled(!localAppReduced);
  }, [localAppReduced]);

  const setAppReduced = useCallback(
    (value: boolean) => {
      setLocalAppReduced(value);
      onAppReducedChange?.(value);
    },
    [onAppReducedChange]
  );

  const value = useMemo<MotionPreference>(
    () => ({
      reduced,
      systemReduced,
      appReduced: localAppReduced,
      setAppReduced,
      ms: (input: number) => (reduced ? 0 : input),
    }),
    [reduced, systemReduced, localAppReduced, setAppReduced]
  );

  // Exposed on the root so CSS can react to the IN-APP setting too. The OS
  // media query in theme.css cannot see it.
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? "true" : "false";
  }, [reduced]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Falls back to "motion allowed" outside a provider rather than throwing.
 * A missing provider should not be able to break a mail list.
 */
export function useMotion(): MotionPreference {
  const context = useContext(Context);
  if (context) return context;
  return {
    reduced: false,
    systemReduced: false,
    appReduced: false,
    setAppReduced: () => {},
    ms: (value: number) => value,
  };
}
