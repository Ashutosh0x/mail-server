import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { duration, easing, gesture, spring, springTiming, transition } from "./motion";
import { haptics } from "./haptics";

describe("motion tokens", () => {
  it("orders durations from fastest to slowest", () => {
    const values = [
      duration.instant,
      duration.micro,
      duration.fast,
      duration.normal,
      duration.smooth,
      duration.slow,
    ];
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it("keeps press feedback within one frame budget at 60fps", () => {
    // Feedback the finger is still touching has to land inside a couple of
    // frames or it reads as lag rather than response.
    expect(duration.instant).toBeLessThanOrEqual(96);
  });

  it("keeps even the slowest transition under half a second", () => {
    // Past ~400ms a transition stops feeling like feedback and starts
    // feeling like waiting.
    expect(duration.slow).toBeLessThanOrEqual(400);
  });
});

describe("easing", () => {
  it("uses distinct curves for entering and exiting", () => {
    // Symmetric easing is the most common way motion ends up feeling sluggish
    // in one direction.
    expect(easing.enter).not.toBe(easing.exit);
  });

  it("emits valid cubic-bezier syntax for every curve", () => {
    for (const [name, curve] of Object.entries(easing)) {
      expect(curve, name).toMatch(/^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/);
    }
  });

  it("keeps the spring overshoot restrained", () => {
    // The second control point governs overshoot. Past ~1.5 it reads as a
    // cartoon bounce rather than a settle.
    const y1 = Number(easing.spring.match(/cubic-bezier\([^,]+,\s*([^,]+)/)![1]);
    expect(y1).toBeGreaterThan(1);
    expect(y1).toBeLessThan(1.5);
  });
});

describe("gesture thresholds", () => {
  it("requires roughly twice the travel for a destructive swipe", () => {
    // Archive is one undo away; trash is not. A single shared threshold is
    // how mail gets deleted by a sleeve brushing the screen.
    expect(gesture.swipeActivateDestructive).toBeGreaterThan(gesture.swipeActivate * 1.8);
  });

  it("never lets a threshold exceed the maximum drag", () => {
    // A threshold beyond the drag limit is unreachable, which would make the
    // action impossible to trigger.
    expect(gesture.swipeActivateDestructive).toBeLessThan(gesture.swipeMax);
  });

  it("needs real movement before a drag starts, so taps stay taps", () => {
    expect(gesture.dragActivationDistance).toBeGreaterThanOrEqual(4);
  });

  it("requires a decisive axis before locking direction", () => {
    // A ratio of 1 would lock on the first pixel of noise and make diagonal
    // drags feel random.
    expect(gesture.directionLockRatio).toBeGreaterThan(1);
  });

  it("cancels a long press on less movement than a drag needs", () => {
    // Otherwise a scroll that begins slowly would open a selection mode.
    expect(gesture.longPressTolerance).toBeLessThanOrEqual(gesture.dragActivationDistance + 2);
  });
});

describe("transition()", () => {
  it("builds a shorthand from the tokens", () => {
    expect(transition("opacity", duration.fast, easing.enter)).toBe(
      `opacity ${duration.fast}ms ${easing.enter}`
    );
  });

  it("joins multiple properties", () => {
    const result = transition(["opacity", "transform"], duration.micro);
    // Not `split(", ")` — the cubic-bezier contains commas of its own, which
    // is exactly the trap this asserts around.
    expect(result).toContain("opacity 120ms");
    expect(result).toContain("transform 120ms");
    expect(result.match(/\d+ms/g)).toHaveLength(2);
  });
});

describe("springTiming()", () => {
  it("settles a snappy spring faster than a gentle one", () => {
    expect(springTiming(spring.snappy).duration).toBeLessThan(springTiming(spring.gentle).duration);
  });

  it("never returns a duration long enough to feel stuck", () => {
    for (const config of Object.values(spring)) {
      expect(springTiming(config).duration).toBeLessThanOrEqual(600);
    }
  });

  it("returns a positive, finite duration for every preset", () => {
    for (const [name, config] of Object.entries(spring)) {
      const { duration: ms } = springTiming(config);
      expect(Number.isFinite(ms), name).toBe(true);
      expect(ms, name).toBeGreaterThan(0);
    }
  });
});

describe("haptics", () => {
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;

  // The rate limiter holds module-level state, so a haptic fired by one test
  // would suppress the first call in the next. `useFakeTimers()` alone does
  // not fix that — it re-seeds from real time, which barely moves between
  // tests. A clock that only ever goes forward does.
  let clock = Date.now();

  beforeEach(() => {
    haptics.setEnabled(true);
    vi.useFakeTimers();
    clock += 10_000;
    vi.setSystemTime(clock);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  });

  function mockDevice({ coarse = true, reduced = false } = {}) {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate },
      configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia: (query: string) => ({
          matches: query.includes("prefers-reduced-motion") ? reduced : coarse,
        }),
      },
      configurable: true,
    });
    return vibrate;
  }

  it("does nothing and reports unsupported when the API is absent", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    Object.defineProperty(globalThis, "window", {
      value: { matchMedia: () => ({ matches: true }) },
      configurable: true,
    });
    // No throw, no claim of success. This is the iOS Safari path.
    expect(haptics.supported).toBe(false);
    expect(haptics.tap()).toBe(false);
  });

  it("does not fire on a device with no coarse pointer", () => {
    mockDevice({ coarse: false });
    expect(haptics.supported).toBe(false);
    expect(haptics.tap()).toBe(false);
  });

  it("fires on a touch device that supports vibration", () => {
    const vibrate = mockDevice();
    expect(haptics.supported).toBe(true);
    expect(haptics.tap()).toBe(true);
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it("rate-limits a burst so a gesture cannot buzz per frame", () => {
    const vibrate = mockDevice();
    haptics.tap();
    // Simulating a continuous swipe: every subsequent call inside the window
    // is dropped.
    for (let i = 0; i < 20; i++) haptics.impact();
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it("suppresses incidental feedback under reduced motion but keeps outcomes", () => {
    const vibrate = mockDevice({ reduced: true });
    expect(haptics.tap()).toBe(false);
    expect(haptics.selection()).toBe(false);
    // A completed action is information, not decoration.
    expect(haptics.success()).toBe(true);
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it("can be disabled entirely by preference", () => {
    const vibrate = mockDevice();
    haptics.setEnabled(false);
    expect(haptics.tap()).toBe(false);
    expect(haptics.success()).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("never throws when the platform rejects the call", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        vibrate: () => {
          throw new Error("blocked: document not engaged");
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: { matchMedia: () => ({ matches: true }) },
      configurable: true,
    });
    // Feedback must never break the action it was decorating.
    expect(() => haptics.tap()).not.toThrow();
    expect(haptics.tap()).toBe(false);
  });
});
