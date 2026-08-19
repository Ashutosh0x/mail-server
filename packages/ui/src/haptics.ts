/**
 * Haptic feedback, centralized.
 *
 * Components call `haptics.tap()`, never `navigator.vibrate` — one abstraction
 * means one place to add a native bridge later, one place to enforce the
 * frequency rules, and one place that knows whether the device can do anything
 * at all.
 *
 * Progressive enhancement throughout: where the capability is missing, every
 * function is a no-op that returns `false`. Nothing in the product may depend
 * on a haptic having fired, and nothing may throw because one could not.
 *
 * A note on what is actually possible on the web today. The Vibration API is
 * the only broadly available primitive, and it is a blunt one: a duration in
 * milliseconds, no amplitude control, and no equivalent of iOS's crisp
 * `UIImpactFeedbackGenerator`. Safari on iOS does not implement it at all, so
 * on an iPhone every call here is a no-op. The patterns below are the closest
 * approximation Android/Chromium allows; the intensity names describe the
 * INTENT so a native wrapper can later map them to real generators.
 */

export type HapticIntensity =
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error"
  | "selection";

/**
 * Vibration patterns in milliseconds, `[on, off, on, ...]`.
 *
 * Kept short. A long buzz reads as an error even when nothing is wrong, and
 * it is the fastest way to make someone disable feedback entirely.
 */
const PATTERNS: Record<HapticIntensity, number | number[]> = {
  // Below ~10ms many drivers produce nothing at all; 8 is the floor worth using.
  selection: 8,
  light: 10,
  medium: 20,
  heavy: 35,
  // Two quick taps read as affirmative without being celebratory.
  success: [12, 60, 12],
  warning: [24, 80, 24],
  // Three descending pulses: distinguishable from success without a long buzz.
  error: [30, 60, 30, 60, 30],
};

/**
 * Minimum gap between haptics, in ms.
 *
 * The rule this enforces is section 36's: a continuous gesture fires at most
 * one haptic when it crosses a threshold, never a stream as the finger moves.
 * Rate limiting here rather than at each call site means a component cannot
 * forget.
 */
const MIN_INTERVAL_MS = 50;

let lastFiredAt = 0;
let enabled = true;

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    // A coarse pointer is a decent proxy for a device where vibration means
    // something. Firing on a desktop with a paired phone would be surprising.
    typeof window !== "undefined" &&
    window.matchMedia("(any-pointer: coarse)").matches
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function fire(intensity: HapticIntensity): boolean {
  if (!enabled || !canVibrate()) return false;

  // Someone asking for reduced motion is asking for a calmer interface.
  // Confirmation of a real outcome still fires; incidental feedback does not.
  if (prefersReducedMotion() && !["success", "warning", "error"].includes(intensity)) {
    return false;
  }

  const now = Date.now();
  if (now - lastFiredAt < MIN_INTERVAL_MS) return false;
  lastFiredAt = now;

  try {
    return navigator.vibrate(PATTERNS[intensity]);
  } catch {
    // Some browsers throw when the document is not visible or not engaged
    // with. Never let feedback break the action it was decorating.
    return false;
  }
}

export const haptics = {
  /** True when a call could actually produce something the user feels. */
  get supported(): boolean {
    return canVibrate();
  },

  /**
   * Turn all haptics off, e.g. from a user preference.
   * Kept as a setter rather than read from storage here so this module stays
   * free of any dependency on how preferences are stored.
   */
  setEnabled(value: boolean): void {
    enabled = value;
  },

  get enabled(): boolean {
    return enabled;
  },

  /** A button press or a tap landing. The lightest thing available. */
  tap: () => fire("light"),

  /** Moving between options: a row selected, a segmented control changing. */
  selection: () => fire("selection"),

  /** A gesture crossing its activation threshold. Fires exactly once. */
  impact: () => fire("medium"),

  /** A real outcome completed: message sent, setting saved. */
  success: () => fire("success"),

  /** Approaching something destructive, or a refusal that is not an error. */
  warning: () => fire("warning"),

  /** An action failed. */
  error: () => fire("error"),

  /** Escape hatch for a specific intensity, still rate-limited. */
  fire,
} as const;
