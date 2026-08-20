package com.mailserver.android.ui.mail

import com.mailserver.android.data.model.Mailbox
import com.mailserver.android.data.model.MessageAction

/**
 * What each action MEANS in each mailbox — the Kotlin side of
 * apps/web/components/mail-selection.ts.
 *
 * This file is a deliberate port, not a reimplementation. "Delete" is not one
 * operation: in the Inbox it moves a conversation to Trash and can be undone;
 * in Trash it destroys the message and its attachments and cannot. If the two
 * clients disagree about which is which, one of them deletes mail the user
 * expected to find in Trash — so the policy is stated once per platform, in one
 * file per platform, and the tables are kept identical.
 *
 * Changing behaviour here without changing mail-selection.ts (or the reverse)
 * is a product bug even when both builds pass. MailPolicyTest pins the table.
 */

/** JMAP roles the UI branches on. Null is a user-created folder. */
object MailboxRole {
    const val INBOX = "inbox"
    const val SENT = "sent"
    const val DRAFTS = "drafts"
    const val ARCHIVE = "archive"
    const val JUNK = "junk"
    const val TRASH = "trash"
}

/**
 * How Delete behaves for the current mailbox.
 *
 * [confirm] is deliberately false wherever Undo is offered instead. A dialog
 * people meet constantly is one they learn to dismiss without reading, which
 * makes the ones that matter less effective — so the confirmation is spent only
 * where the operation cannot be undone.
 */
data class DeletePolicy(
    /** The operation sent to /api/mail/actions. */
    val operation: DeleteOperation,
    /** What the button says. Never just "Delete" when it is irreversible. */
    val label: String,
    val confirm: Boolean,
    val confirmTitle: String,
    val confirmBody: String,
) {
    /** Undo is offered exactly where the operation is reversible. */
    val undoable: Boolean get() = operation == DeleteOperation.Trash
}

/**
 * Trash moves a row; Purge destroys the row and its attachment bytes.
 *
 * Purge is not a [MessageAction] for the same reason it is not one on the
 * server: everything in that enum moves a row or flips a flag and is
 * reversible. Purge takes the storage-cleanup path — blobs before rows, partial
 * failure reported honestly — and modelling it as a sibling of "archive" would
 * hide that difference at exactly the call site where it matters most.
 */
enum class DeleteOperation(val wire: String) {
    Trash("trash"),
    Purge("purge"),
}

/**
 * The delete policy for [role], worded for [count] conversations.
 *
 * Mirrors `deletePolicyFor` in mail-selection.ts, including the wording, since
 * the confirmation text is the last thing standing between a user and
 * irreversible loss.
 */
fun deletePolicyFor(role: String?, count: Int): DeletePolicy {
    val plural = if (count == 1) "conversation" else "conversations"

    return when (role) {
        MailboxRole.TRASH -> DeletePolicy(
            operation = DeleteOperation.Purge,
            label = "Delete permanently",
            confirm = true,
            confirmTitle = "Delete permanently?",
            confirmBody =
                "This permanently deletes $count $plural and any attachments. It cannot be undone.",
        )

        MailboxRole.JUNK -> DeletePolicy(
            operation = DeleteOperation.Purge,
            label = "Delete permanently",
            confirm = true,
            confirmTitle = "Delete permanently?",
            confirmBody = "This permanently deletes $count spam $plural. It cannot be undone.",
        )

        // A draft has never been sent, so Trash would only be a second place
        // for it to sit unfinished.
        MailboxRole.DRAFTS -> DeletePolicy(
            operation = DeleteOperation.Purge,
            label = "Delete draft",
            confirm = true,
            confirmTitle = if (count == 1) "Delete this draft?" else "Delete $count drafts?",
            confirmBody =
                "Deleting a draft removes it and its attachments for good. It cannot be undone.",
        )

        else -> DeletePolicy(
            operation = DeleteOperation.Trash,
            label = "Delete",
            confirm = false,
            confirmTitle = "",
            confirmBody = "",
        )
    }
}

/**
 * One action offered on a selection.
 *
 * [primary] surfaces in the bar itself; everything else goes behind More. On a
 * phone the bar holds far fewer controls than the web toolbar does, so the
 * distinction carries more weight here — but Delete is never behind More, on
 * either platform. It is the action people opened the toolbar for.
 */
data class SelectionAction(
    val id: String,
    val label: String,
    val action: MessageAction,
    val primary: Boolean = false,
)

/**
 * The actions that can actually do something in [role].
 *
 * "Restore" belongs in Trash, Spam and Archive; "Not spam" only in Spam;
 * neither belongs in the Inbox. An action offered where it is meaningless is a
 * button that appears to fail.
 */
fun actionsFor(role: String?): List<SelectionAction> {
    val common = listOf(
        SelectionAction("read", "Mark read", MessageAction.Read),
        SelectionAction("unread", "Mark unread", MessageAction.Unread),
        SelectionAction("star", "Star", MessageAction.Star),
        SelectionAction("unstar", "Unstar", MessageAction.Unstar),
    )

    return when (role) {
        MailboxRole.TRASH ->
            listOf(SelectionAction("restore", "Restore", MessageAction.Restore, primary = true)) + common

        MailboxRole.JUNK ->
            listOf(SelectionAction("restore", "Not spam", MessageAction.Restore, primary = true)) + common

        // A draft cannot be archived, starred or marked read: it was never
        // received. Delete is the only thing that applies, and it is not in
        // this list because it comes from the delete policy instead.
        MailboxRole.DRAFTS -> emptyList()

        MailboxRole.ARCHIVE -> listOf(
            SelectionAction("restore", "Move to Inbox", MessageAction.Restore, primary = true),
            SelectionAction("spam", "Report spam", MessageAction.Spam),
        ) + common

        else -> listOf(
            SelectionAction("archive", "Archive", MessageAction.Archive, primary = true),
            SelectionAction("spam", "Report spam", MessageAction.Spam),
        ) + common
    }
}

/**
 * The real inverse of each action, for Undo — mirrors INVERSE_ACTION in
 * mail-client.tsx.
 *
 * Only actions with a genuine reversal appear here. [MessageAction.Delete] is
 * absent because nothing restores a permanently deleted message, and offering
 * Undo for it would be a promise the backend cannot keep.
 *
 * `restore` has no entry either: its inverse depends on where the message came
 * from, which the client does not know once the move has happened.
 */
fun inverseOf(action: MessageAction): MessageAction? = when (action) {
    MessageAction.Archive -> MessageAction.Restore
    MessageAction.Trash -> MessageAction.Restore
    MessageAction.Spam -> MessageAction.Restore
    MessageAction.Read -> MessageAction.Unread
    MessageAction.Unread -> MessageAction.Read
    MessageAction.Star -> MessageAction.Unstar
    MessageAction.Unstar -> MessageAction.Star
    MessageAction.Restore -> null
    MessageAction.Delete -> null
}

/** Past tense for the confirmation snackbar. Mirrors PAST_TENSE in mail-client.tsx. */
fun pastTenseOf(action: MessageAction): String = when (action) {
    MessageAction.Archive -> "archived"
    MessageAction.Trash -> "moved to trash"
    MessageAction.Spam -> "marked as spam"
    MessageAction.Restore -> "restored"
    MessageAction.Read -> "marked read"
    MessageAction.Unread -> "marked unread"
    MessageAction.Star -> "starred"
    MessageAction.Unstar -> "unstarred"
    MessageAction.Delete -> "deleted"
}

/**
 * Empty-state wording per mailbox role — mirrors `emptyStateFor` in
 * mail-client.tsx.
 *
 * Says what is true and offers no fiction. There is no placeholder list, no
 * sample message and no illustration standing in for content the account does
 * not have.
 */
data class EmptyStateCopy(val title: String, val body: String)

fun emptyStateFor(role: String?, searching: Boolean): EmptyStateCopy {
    if (searching) {
        return EmptyStateCopy(
            "No messages match",
            "Try removing a filter or searching for something else.",
        )
    }
    return when (role) {
        MailboxRole.INBOX -> EmptyStateCopy("Your inbox is empty", "New messages will appear here.")
        MailboxRole.SENT -> EmptyStateCopy("No sent messages yet", "Messages you send will appear here.")
        MailboxRole.DRAFTS -> EmptyStateCopy("No drafts", "Drafts are saved here as you write.")
        MailboxRole.ARCHIVE -> EmptyStateCopy("Nothing archived", "Archived messages are kept out of your inbox.")
        MailboxRole.JUNK -> EmptyStateCopy("No spam", "Messages we flag as spam appear here.")
        MailboxRole.TRASH -> EmptyStateCopy("Trash is empty", "Deleted messages are kept here before removal.")
        else -> EmptyStateCopy("Nothing here yet", "This folder has no messages.")
    }
}

/**
 * The order system mailboxes appear in the drawer, matching the web sidebar.
 *
 * Roles the server did not send are simply absent — the drawer lists the
 * account's real mailboxes, never a fixed menu with dead entries. User-created
 * folders keep their server-provided [Mailbox.sortOrder] and follow the system
 * ones.
 */
private val ROLE_ORDER = listOf(
    MailboxRole.INBOX,
    MailboxRole.DRAFTS,
    MailboxRole.SENT,
    MailboxRole.ARCHIVE,
    MailboxRole.JUNK,
    MailboxRole.TRASH,
)

fun sortMailboxesForDrawer(mailboxes: List<Mailbox>): List<Mailbox> =
    mailboxes.sortedWith(
        compareBy(
            { ROLE_ORDER.indexOf(it.role).takeIf { i -> i >= 0 } ?: ROLE_ORDER.size },
            { it.sortOrder },
            { it.name },
        )
    )

/**
 * The count a drawer row shows, or null when the row shows none.
 *
 * Unread is the meaningful number for a mailbox you receive into. For Drafts
 * and Sent nothing was ever received, so "unread" is not a fact about them —
 * Drafts shows how many drafts exist, and Sent shows nothing at all rather than
 * a permanent zero that reads as a bug.
 *
 * Every number returned here came from the server's mailbox record. None is
 * derived from the loaded page, which would report "3" for a mailbox holding
 * three thousand.
 */
fun drawerCountFor(mailbox: Mailbox): Int? = when (mailbox.role) {
    MailboxRole.DRAFTS -> mailbox.totalThreads
    MailboxRole.SENT -> null
    else -> mailbox.unreadThreads
}
