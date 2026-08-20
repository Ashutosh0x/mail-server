import { describe, expect, it } from "vitest";
import { actionsFor, deletePolicyFor } from "./mail-selection";

/**
 * What "Delete" means, per mailbox.
 *
 * This is the table that decides whether a click moves a conversation or
 * destroys it, so it is tested directly rather than only through the UI. A
 * regression here does not throw or render wrong — it quietly deletes mail
 * someone expected to find in Trash.
 */

describe("delete policy", () => {
  it("moves to Trash from the mailboxes that have a Trash to move to", () => {
    for (const role of ["inbox", "sent", "archive"] as const) {
      const policy = deletePolicyFor(role, 1);
      expect(policy.operation, role).toBe("trash");
      // Reversible, so no dialog: a confirmation people meet constantly is one
      // they learn to dismiss without reading.
      expect(policy.confirm, role).toBe(false);
      expect(policy.label, role).toBe("Delete");
    }
  });

  it("destroys, and says so, where there is nowhere left to move to", () => {
    for (const role of ["trash", "junk", "drafts"] as const) {
      const policy = deletePolicyFor(role, 1);
      expect(policy.operation, role).toBe("purge");
      expect(policy.confirm, role).toBe(true);
      // The label must never read simply "Delete" when it cannot be undone.
      expect(policy.label, role).not.toBe("Delete");
      expect(policy.confirmBody.toLowerCase(), role).toContain("cannot be undone");
    }
  });

  it("names the count so the confirmation is about what was actually chosen", () => {
    expect(deletePolicyFor("trash", 1).confirmBody).toContain("1 conversation");
    expect(deletePolicyFor("trash", 4).confirmBody).toContain("4 conversations");
  });

  it("uses draft wording for drafts, which were never received", () => {
    const one = deletePolicyFor("drafts", 1);
    expect(one.label).toBe("Delete draft");
    expect(one.confirmTitle).toBe("Delete this draft?");
    expect(deletePolicyFor("drafts", 3).confirmTitle).toBe("Delete 3 drafts?");
  });

  it("falls back to the reversible behaviour for an unknown mailbox", () => {
    // A custom folder should not silently become a permanent delete.
    expect(deletePolicyFor(null, 1).operation).toBe("trash");
    expect(deletePolicyFor(null, 1).confirm).toBe(false);
  });
});

describe("available actions", () => {
  it("offers Archive from the Inbox but not from Archive itself", () => {
    expect(actionsFor("inbox").map((a) => a.id)).toContain("archive");
    expect(actionsFor("archive").map((a) => a.id)).not.toContain("archive");
  });

  it("offers Restore only where something can be restored", () => {
    expect(actionsFor("trash").map((a) => a.id)).toContain("restore");
    expect(actionsFor("junk").map((a) => a.id)).toContain("restore");
    expect(actionsFor("archive").map((a) => a.id)).toContain("restore");
    // Nothing to restore from the Inbox; the message is already there.
    expect(actionsFor("inbox").map((a) => a.id)).not.toContain("restore");
  });

  it("labels leaving Spam as Not spam rather than Restore", () => {
    expect(actionsFor("junk").find((a) => a.id === "restore")?.label).toBe("Not spam");
  });

  it("does not offer to report spam from inside Spam", () => {
    expect(actionsFor("junk").map((a) => a.id)).not.toContain("spam");
  });

  it("offers nothing but deletion for drafts", () => {
    // A draft cannot be archived, starred or marked read: it was never received.
    expect(actionsFor("drafts")).toEqual([]);
  });

  it("gives every mailbox exactly one primary action, or none", () => {
    for (const role of ["inbox", "sent", "archive", "trash", "junk", "drafts"] as const) {
      const primary = actionsFor(role).filter((a) => a.primary);
      expect(primary.length, role).toBeLessThanOrEqual(1);
    }
  });
});
