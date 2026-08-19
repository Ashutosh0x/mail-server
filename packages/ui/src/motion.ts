/**
 * The motion system.
 *
 * One place for every duration, easing and gesture threshold in the product.
 * Numbers scattered through components drift: three dialogs end up with three
 * different open durations and nobody notices until they are side by side.
 *
 * No animation library. That is a deliberate choice, not an omission — this
 * repository already carries eight declared dependencies that no file imports,
 * and everything the interaction design needs (springs, layout animation,
 * gesture tracking) is reachable through CSS transitions, the Web Animations
 * API and FLIP. A ~50KB runtime to move a menu 4px is the wrong trade for an
 * application whose first design goal is "fast".
 */

/**
 * Durations in milliseconds.
 *
 * Calibrated to interaction type, not applied uniformly:
 *   - `instant` is for feedback the finger is still touching — a press state.
 *     Anything slower reads as lag rather than response.
 *   - `micro` is for a property changing in place: a colour, an icon swap.
 *   - `fast` is for something small appearing or leaving.
 *   - `normal` is the default for a panel or menu.
 *   - `smooth` is for a surface crossing a large part of the screen.
 *   - `slow` is reserved for a full-screen transition. Rare on purpose.
 */
export const duration = {
  instant: 80,
  micro: 120,
  fast: 160,
  normal: 200,
  smooth: 280,
  slow: 400,
} as const;

/**
 * Easing curves.
 *
 * Entering uses ease-out so the element decelerates into place and the eye
 * catches its final position early. Exiting uses ease-in so it accelerates
 * away and the wait feels shorter. `standard` is for a property changing while
 * the element stays put, where symmetry looks right.
 */
export const easing = {
  /** In-place state change: colour, opacity, a value updating. */
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  /** Appearing. Decelerates into position. */
  enter: "cubic-bezier(0, 0, 0, 1)",
  /** Leaving. Accelerates away. */
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  /** A single restrained overshoot, for direct manipulation snapping back. */
  spring: "cubic-bezier(0.2, 1.2, 0.3, 1)",
} as const;

/**
 * Spring parameters for gesture-driven motion, used by the Web Animations API
 * rather than CSS — a spring's duration depends on where the gesture released,
 * which a static CSS curve cannot express.
 *
 * `snappy` settles fast enough that a released swipe feels attached to the
 * finger. `gentle` is for something returning to rest with no urgency.
 */
export const spring = {
  gentle: { stiffness: 170, damping: 26, mass: 1 },
  snappy: { stiffness: 320, damping: 30, mass: 0.9 },
} as const;

/**
 * Gesture thresholds.
 *
 * `swipeActivate` is a fraction of the element's width rather than a pixel
 * count, so the same gesture feels the same on a 360px phone and a 1024px
 * tablet.
 *
 * `swipeActivateDestructive` is deliberately much further. Archive is one
 * undo away; trash should take intent. Making both 0.3 is how people delete
 * mail by brushing the screen in a pocket.
 */
export const gesture = {
  /** Movement before a drag is recognised at all, so taps stay taps. */
  dragActivationDistance: 8,
  /**
   * Once movement exceeds this ratio in one axis, the other axis is locked out
   * for the rest of the gesture. Without directional locking a diagonal drag
   * both scrolls the list and swipes the row.
   */
  directionLockRatio: 1.4,
  /** Fraction of row width to trigger a reversible action. */
  swipeActivate: 0.28,
  /** Fraction of row width to trigger a destructive one. */
  swipeActivateDestructive: 0.55,
  /** Beyond this the row cannot be dragged further, so the limit is felt. */
  swipeMax: 0.75,
  /** Resistance applied past the maximum, giving the edge a rubber feel. */
  overdragFactor: 0.25,
  longPressDuration: 500,
  /** Movement that cancels a long press, so a scroll never selects a row. */
  longPressTolerance: 10,
  /** Pull distance to trigger a refresh. */
  pullRefreshThreshold: 72,
  pullRefreshMax: 120,
} as const;

export const motion = { duration, easing, spring, gesture } as const;

/** `transition` shorthand from the tokens, so call sites never write raw ms. */
export function transition(
  properties: string | string[],
  ms: number = duration.normal,
  curve: string = easing.standard
): string {
  const list = Array.isArray(properties) ? properties : [properties];
  return list.map((property) => `${property} ${ms}ms ${curve}`).join(", ");
}

/**
 * Convert spring constants to a Web Animations API duration and easing.
 *
 * An exact spring needs per-frame integration. This approximates one closely
 * enough for a 200ms settle while staying declarative, which keeps the
 * animation on the compositor instead of running a rAF loop per row.
 */
export function springTiming(config: { stiffness: number; damping: number; mass: number }): {
  duration: number;
  easing: string;
} {
  const undamped = Math.sqrt(config.stiffness / config.mass);
  const ratio = config.damping / (2 * Math.sqrt(config.stiffness * config.mass));
  // Time for the envelope to decay to ~2%, capped so nothing feels stuck.
  const settle = Math.min(600, Math.round((4 / (ratio * undamped)) * 1000));
  return {
    duration: settle,
    easing: ratio >= 1 ? easing.enter : easing.spring,
  };
}
