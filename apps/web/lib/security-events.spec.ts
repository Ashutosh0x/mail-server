import { describe, expect, it } from "vitest";
import {
  categorise,
  describeEventDevice,
  formatEventTime,
  groupByDay,
  presentEvent,
} from "./security-events";
import type { AuditEntry } from "./account-types";

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "a",
    action: "auth.login",
    severity: "info",
    createdAt: "2026-08-20T10:00:00.000Z",
    ipAddress: null,
    browser: null,
    os: null,
    deviceType: null,
    ...over,
  };
}

describe("presentEvent", () => {
  it("turns machine codes into readable labels", () => {
    expect(presentEvent("auth.login").label).toBe("Signed in");
    expect(presentEvent("auth.logout").label).toBe("Signed out");
    expect(presentEvent("account.created").label).toBe("Account created");
    expect(presentEvent("profile.updated").label).toBe("Profile updated");
  });

  it("understands the legacy SCREAMING_SNAKE codes still in real history", () => {
    // Those rows are genuine events. Rewriting or deleting them to tidy the UI
    // would be falsifying an audit log, so the display layer reads both forms.
    expect(presentEvent("PROFILE_UPDATED").label).toBe("Profile updated");
    expect(presentEvent("SESSION_REVOKED").label).toBe("Session signed out");
    expect(presentEvent("PASSKEY_REVOKED").label).toBe("Passkey removed");
  });

  it("gives the same presentation for a legacy code and its modern form", () => {
    expect(presentEvent("PROFILE_UPDATED")).toEqual(presentEvent("profile.updated"));
  });

  it("shows an unrecognised code rather than hiding the event", () => {
    // An audit trail that silently drops what it does not recognise is not an
    // audit trail. The raw code is what a reader needs in order to ask.
    const shown = presentEvent("something.unexpected");
    expect(shown.label.toLowerCase()).toContain("something");
    expect(shown.label.toLowerCase()).toContain("unexpected");
  });

  it("marks security-relevant events as needing attention", () => {
    expect(presentEvent("session.revoked").tone).toBe("attention");
    expect(presentEvent("auth.failed").tone).toBe("attention");
    expect(presentEvent("mfa.disabled").tone).toBe("attention");
  });

  it("distinguishes mailbox actions from security events", () => {
    expect(presentEvent("mail.archive").label).toContain("Mailbox action");
  });

  it("returns a real icon component for every known event", () => {
    for (const action of ["auth.login", "profile.updated", "session.revoked", "mail.archive", "wat"]) {
      const icon = presentEvent(action).icon;
      expect(typeof icon === "function" || typeof icon === "object", action).toBe(true);
    }
  });
});

describe("categorise", () => {
  it("buckets events for the activity filter", () => {
    expect(categorise("auth.login")).toBe("signin");
    expect(categorise("auth.logout")).toBe("signin");
    expect(categorise("profile.updated")).toBe("profile");
    expect(categorise("preferences.updated")).toBe("profile");
    expect(categorise("session.revoked")).toBe("security");
    expect(categorise("mail.archive")).toBe("mail");
  });

  it("buckets a legacy code the same way as its modern form", () => {
    expect(categorise("PROFILE_UPDATED")).toBe(categorise("profile.updated"));
    expect(categorise("SESSION_REVOKED")).toBe(categorise("session.revoked"));
  });

  it("treats anything unrecognised as security rather than dropping it", () => {
    expect(categorise("brand.new.event")).toBe("security");
  });
});

describe("groupByDay", () => {
  const now = new Date("2026-08-20T12:00:00");

  it("splits events into Today, Yesterday, this week and earlier", () => {
    const groups = groupByDay(
      [
        entry({ id: "1", createdAt: new Date("2026-08-20T09:00:00").toISOString() }),
        entry({ id: "2", createdAt: new Date("2026-08-19T09:00:00").toISOString() }),
        entry({ id: "3", createdAt: new Date("2026-08-17T09:00:00").toISOString() }),
        entry({ id: "4", createdAt: new Date("2026-07-01T09:00:00").toISOString() }),
      ],
      now
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Earlier this week", "Earlier"]);
  });

  it("preserves order within a day and never merges separate events", () => {
    // Two profile updates seconds apart are two real events. Collapsing them
    // would hide that something changed twice.
    const groups = groupByDay(
      [
        entry({ id: "1", action: "profile.updated", createdAt: new Date("2026-08-20T09:00:02").toISOString() }),
        entry({ id: "2", action: "profile.updated", createdAt: new Date("2026-08-20T09:00:01").toISOString() }),
      ],
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("returns nothing for an empty list rather than an empty bucket", () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it("keeps an unparseable timestamp instead of discarding the event", () => {
    const groups = groupByDay([entry({ createdAt: "not-a-date" })], now);
    expect(groups[0]!.label).toBe("Unknown date");
    expect(groups[0]!.entries).toHaveLength(1);
  });
});

describe("describeEventDevice", () => {
  it("returns null when nothing was recorded, so the UI can say so honestly", () => {
    // Every event written before audit() captured request context has no
    // device. Inventing a plausible browser would be fabrication.
    expect(describeEventDevice(entry())).toBeNull();
  });

  it("combines browser and OS when both are known", () => {
    expect(describeEventDevice(entry({ browser: "Chrome", os: "Windows" }))).toBe("Chrome · Windows");
  });

  it("returns whichever half is known", () => {
    expect(describeEventDevice(entry({ browser: "Firefox" }))).toBe("Firefox");
    expect(describeEventDevice(entry({ os: "Linux" }))).toBe("Linux");
  });
});

describe("formatEventTime", () => {
  it("formats a valid timestamp", () => {
    expect(formatEventTime(new Date("2026-08-20T09:05:00").toISOString())).toMatch(/\d/);
  });

  it("does not throw on a malformed timestamp", () => {
    expect(formatEventTime("nonsense")).toBe("Unknown time");
  });
});
