import type { Preferences } from "./account-types";

/**
 * The pure half of the account layer.
 *
 * Separate from `lib/server/account.ts` because that module is `server-only`,
 * which makes it unimportable from a test runner. Nothing here touches a
 * request, a cookie or the database — it is string parsing and constants — so
 * marking it server-only would buy no safety and cost the tests.
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown";

/**
 * Derive browser and OS from a user-agent string.
 *
 * Returns "Unknown" rather than guessing. A device list that confidently
 * mislabels a session is worse than one that admits it cannot tell, because
 * the whole point of the screen is recognising your own devices.
 *
 * Order matters, and it is the part that is easy to get wrong: Edge's UA
 * contains "Chrome", Chrome's contains "Safari", and all of them contain
 * "Mozilla". Testing the most specific marker first is what keeps every
 * Chromium browser from reporting as Safari.
 *
 * The input is an attacker-controlled header, so every branch is a bounded
 * regex over a string and nothing here can throw.
 */
export function describeUserAgent(ua: string | null): {
  browser: string;
  os: string;
  deviceType: DeviceType;
} {
  if (!ua) return { browser: "Unknown", os: "Unknown", deviceType: "unknown" };

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /curl\//i.test(ua) ? "curl"
    : "Unknown";

  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown";

  const deviceType: DeviceType =
    /iPad|Tablet/.test(ua) ? "tablet"
    : /Mobi|Android|iPhone/.test(ua) ? "mobile"
    : os === "Unknown" ? "unknown"
    : "desktop";

  return { browser, os, deviceType };
}

/**
 * Preference defaults.
 *
 * Every privacy default is the privacy-preserving option, so a user who never
 * opens the screen is not opted into anything by that inaction. Security
 * alerts default on and live in their own field, so turning off
 * "notifications" cannot silence a sign-in from an unrecognised device.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  appearance: {
    theme: "system",
    density: "comfortable",
    reducedMotion: false,
    messagePreview: true,
    sidebarCollapsed: false,
  },
  notifications: {
    desktop: false,
    sound: false,
    newMail: true,
    mentions: true,
    securityAlerts: true,
  },
  privacy: {
    remoteImages: "block",
    trackingProtection: true,
    linkProtection: true,
    aiProcessing: "off",
    telemetry: false,
  },
};
