import type { Mailbox } from "@mailserver/types";

/**
 * What each action MEANS in each mailbox.
 *
 * "Delete" is not one operation. In the Inbox it moves a conversation to Trash
 * and can be undone; in Trash it destroys the message and its attachments and
 * cannot. Shipping both behind one unlabelled button is how people lose mail
 * they meant to keep, so the mailbox decides the wording, the confirmation and
 * the underlying operation — in one place, rather than in each component that
 * happens to draw a delete button.
 */

export type MailboxRole = Mailbox["role"];

export interface DeletePolicy {
  /** The operation sent to /api/mail/actions. */
  operation: "trash" | "purge";
  /** What the button says. Never just "Delete" when it is irreversible. */
  label: string;
  /** Irreversible operations are confirmed; reversible ones are not. */
  confirm: boolean;
  confirmTitle: string;
  confirmBody: string;
}

const PERMANENT: Omit<DeletePolicy, "confirmBody"> = {
  operation: "purge",
  label: "Delete permanently",
  confirm: true,
  confirmTitle: "Delete permanently?",
};

export function deletePolicyFor(role: MailboxRole | null, count: number): DeletePolicy {
  const plural = count === 1 ? "conversation" : "conversations";

  switch (role) {
    case "trash":
      return {
        ...PERMANENT,
        confirmBody: `This permanently deletes ${count} ${plural} and any attachments. It cannot be undone.`,
      };

    case "junk":
      return {
        ...PERMANENT,
        confirmBody: `This permanently deletes ${count} spam ${plural}. It cannot be undone.`,
      };

    case "drafts":
      return {
        ...PERMANENT,
        label: "Delete draft",
        confirmTitle: count === 1 ? "Delete this draft?" : `Delete ${count} drafts?`,
        // A draft has never been sent, so Trash would only be a second place
        // for it to sit unfinished.
        confirmBody: `Deleting a draft removes it and its attachments for good. It cannot be undone.`,
      };

    default:
      return {
        operation: "trash",
        label: "Delete",
        // Reversible, and Undo is offered — a confirmation here is a dialog
        // people learn to dismiss without reading, which makes the ones that
        // matter less effective.
        confirm: false,
        confirmTitle: "",
        confirmBody: "",
      };
  }
}

export interface SelectionAction {
  id: string;
  label: string;
  /** The operation sent to the API. */
  operation: string;
  /** Shown in the toolbar rather than behind More. */
  primary?: boolean;
  destructive?: boolean;
}

/**
 * The actions that make sense in a given mailbox.
 *
 * Only actions that can actually do something here: "Restore" belongs in Trash
 * and Archive, "Not spam" only in Spam, and neither belongs in the Inbox. An
 * action offered where it is meaningless is a button that appears to fail.
 */
export function actionsFor(role: MailboxRole | null): SelectionAction[] {
  const common: SelectionAction[] = [
    { id: "read", label: "Mark read", operation: "read" },
    { id: "unread", label: "Mark unread", operation: "unread" },
    { id: "star", label: "Star", operation: "star" },
    { id: "unstar", label: "Unstar", operation: "unstar" },
  ];

  switch (role) {
    case "trash":
      return [
        { id: "restore", label: "Restore", operation: "restore", primary: true },
        ...common,
      ];

    case "junk":
      return [
        { id: "restore", label: "Not spam", operation: "restore", primary: true },
        ...common,
      ];

    case "drafts":
      // A draft cannot be archived or marked read: it was never received.
      return [];

    case "archive":
      return [
        { id: "restore", label: "Move to Inbox", operation: "restore", primary: true },
        { id: "spam", label: "Report spam", operation: "spam" },
        ...common,
      ];

    default:
      return [
        { id: "archive", label: "Archive", operation: "archive", primary: true },
        { id: "spam", label: "Report spam", operation: "spam" },
        ...common,
      ];
  }
}
