package com.mailserver.android.ui.mail

import com.mailserver.android.data.model.Mailbox
import com.mailserver.android.data.model.MessageAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What "Delete" means, per mailbox.
 *
 * The mirror of apps/web/components/mail-selection.spec.ts, deliberately
 * asserting the same facts in the same order. This is the table that decides
 * whether a tap moves a conversation or destroys it, so it is tested directly
 * rather than only through the UI — a regression here does not throw or render
 * wrong, it quietly deletes mail someone expected to find in Trash.
 *
 * If a case here starts failing, the fix is almost never to change the
 * assertion. It is to check whether the web policy changed and this one did
 * not, because the two clients disagreeing about deletion is the actual bug.
 */
class MailPolicyTest {

    // ── Delete policy ─────────────────────────────────────────────────────

    @Test
    fun `moves to Trash from the mailboxes that have a Trash to move to`() {
        for (role in listOf(MailboxRole.INBOX, MailboxRole.SENT, MailboxRole.ARCHIVE)) {
            val policy = deletePolicyFor(role, 1)
            assertEquals(role, DeleteOperation.Trash, policy.operation)
            // Reversible, so no dialog: a confirmation people meet constantly
            // is one they learn to dismiss without reading.
            assertFalse(role, policy.confirm)
            assertEquals(role, "Delete", policy.label)
            assertTrue(role, policy.undoable)
        }
    }

    @Test
    fun `destroys, and says so, where there is nowhere left to move to`() {
        for (role in listOf(MailboxRole.TRASH, MailboxRole.JUNK, MailboxRole.DRAFTS)) {
            val policy = deletePolicyFor(role, 1)
            assertEquals(role, DeleteOperation.Purge, policy.operation)
            assertTrue(role, policy.confirm)
            // The label must never read simply "Delete" when it cannot be undone.
            assertNotEquals(role, "Delete", policy.label)
            assertTrue(role, policy.confirmBody.lowercase().contains("cannot be undone"))
            // And Undo must not be offered for it anywhere in the UI.
            assertFalse(role, policy.undoable)
        }
    }

    @Test
    fun `names the count so the confirmation is about what was actually chosen`() {
        assertTrue(deletePolicyFor(MailboxRole.TRASH, 1).confirmBody.contains("1 conversation"))
        assertTrue(deletePolicyFor(MailboxRole.TRASH, 4).confirmBody.contains("4 conversations"))
    }

    @Test
    fun `an unknown or user-created folder gets the reversible policy`() {
        // A folder the server gave no role to is an ordinary folder, and its
        // messages can go to Trash like any others. Defaulting to purge here
        // would make every custom folder a shredder.
        val policy = deletePolicyFor(null, 1)
        assertEquals(DeleteOperation.Trash, policy.operation)
        assertFalse(policy.confirm)
    }

    // ── Actions offered ───────────────────────────────────────────────────

    @Test
    fun `only offers actions that can do something here`() {
        val inbox = actionsFor(MailboxRole.INBOX).map { it.id }
        assertTrue(inbox.contains("archive"))
        // Nothing to restore from in the Inbox — the message is already there.
        assertFalse(inbox.contains("restore"))

        val trash = actionsFor(MailboxRole.TRASH).map { it.id }
        assertTrue(trash.contains("restore"))
        assertFalse(trash.contains("archive"))

        // Spam's restore is worded for what it means there.
        assertEquals("Not spam", actionsFor(MailboxRole.JUNK).first { it.id == "restore" }.label)
        assertEquals("Move to Inbox", actionsFor(MailboxRole.ARCHIVE).first { it.id == "restore" }.label)
    }

    @Test
    fun `drafts offer no state actions at all`() {
        // A draft was never received, so it cannot be archived, starred or
        // marked read. Delete is the only thing that applies, and that comes
        // from the delete policy rather than from this list.
        assertTrue(actionsFor(MailboxRole.DRAFTS).isEmpty())
    }

    @Test
    fun `every mailbox with actions has exactly one primary`() {
        for (role in listOf(MailboxRole.INBOX, MailboxRole.SENT, MailboxRole.ARCHIVE, MailboxRole.TRASH, MailboxRole.JUNK)) {
            val primary = actionsFor(role).filter { it.primary }
            assertEquals(role, 1, primary.size)
        }
    }

    // ── Undo ──────────────────────────────────────────────────────────────

    @Test
    fun `undo is offered only where the server can genuinely reverse it`() {
        assertEquals(MessageAction.Restore, inverseOf(MessageAction.Archive))
        assertEquals(MessageAction.Restore, inverseOf(MessageAction.Trash))
        assertEquals(MessageAction.Restore, inverseOf(MessageAction.Spam))
        assertEquals(MessageAction.Unread, inverseOf(MessageAction.Read))
        assertEquals(MessageAction.Star, inverseOf(MessageAction.Unstar))

        // Nothing restores a permanently deleted message, so offering Undo for
        // it would be a promise the backend cannot keep.
        assertNull(inverseOf(MessageAction.Delete))
        // Restore's inverse depends on where the message came from, which the
        // client does not know once the move has happened.
        assertNull(inverseOf(MessageAction.Restore))
    }

    @Test
    fun `every reversible inverse is itself reversible back`() {
        for (action in listOf(
            MessageAction.Read, MessageAction.Unread,
            MessageAction.Star, MessageAction.Unstar,
        )) {
            assertEquals(action.wire, action, inverseOf(inverseOf(action)!!))
        }
    }

    // ── Swipe gestures ────────────────────────────────────────────────────

    @Test
    fun `no swipe reaches an irreversible delete`() {
        // §32: a destructive-and-irreversible action must not be reachable by a
        // gesture that can be started by accident. In these mailboxes deletion
        // is permanent, so the swipe is absent and the toolbar — with its
        // confirmation — is the only way through.
        for (role in listOf(MailboxRole.TRASH, MailboxRole.JUNK, MailboxRole.DRAFTS)) {
            assertNull(role, leadingSwipeFor(role))
        }
    }

    @Test
    fun `swipe actions exist in the mailbox toolbar too`() {
        // §41: nothing is gesture-only. Archive is reachable by swipe in the
        // Inbox and is also one of the Inbox's toolbar actions.
        val swipe = leadingSwipeFor(MailboxRole.INBOX)
        assertEquals(MessageAction.Archive, swipe?.action)
        assertTrue(actionsFor(MailboxRole.INBOX).any { it.action == swipe?.action })
    }

    @Test
    fun `the read toggle follows the row's current state`() {
        assertEquals(MessageAction.Read, trailingSwipeFor(MailboxRole.INBOX, isUnread = true)?.action)
        assertEquals(MessageAction.Unread, trailingSwipeFor(MailboxRole.INBOX, isUnread = false)?.action)
        // A draft has no read state to toggle.
        assertNull(trailingSwipeFor(MailboxRole.DRAFTS, isUnread = true))
    }

    @Test
    fun `archive's swipe delete is marked destructive so it takes the longer threshold`() {
        // Trash is reversible, but from Archive it is still the action that
        // makes a conversation disappear from the view, and it is the only
        // swipe in the app that files rather than toggles.
        assertTrue(leadingSwipeFor(MailboxRole.ARCHIVE)!!.destructive)
        assertFalse(leadingSwipeFor(MailboxRole.INBOX)!!.destructive)
    }

    // ── Drawer ────────────────────────────────────────────────────────────

    @Test
    fun `drawer counts come from the server and are never invented`() {
        val inbox = mailbox(role = MailboxRole.INBOX, unreadThreads = 4, totalThreads = 30)
        assertEquals(4, drawerCountFor(inbox))

        // Zero IS shown. It is a fact about the mailbox, not a missing value.
        assertEquals(0, drawerCountFor(inbox.copy(unreadThreads = 0)))

        // Drafts were never received, so "unread" is not a fact about them —
        // the count shown is how many drafts exist.
        val drafts = mailbox(role = MailboxRole.DRAFTS, unreadThreads = 0, totalThreads = 2)
        assertEquals(2, drawerCountFor(drafts))

        // Sent shows nothing at all rather than a permanent zero that reads as
        // a bug.
        assertNull(drawerCountFor(mailbox(role = MailboxRole.SENT, unreadThreads = 0, totalThreads = 9)))
    }

    @Test
    fun `the drawer orders system mailboxes like the web sidebar`() {
        val shuffled = listOf(
            mailbox(id = "t", role = MailboxRole.TRASH),
            mailbox(id = "i", role = MailboxRole.INBOX),
            mailbox(id = "s", role = MailboxRole.SENT),
            mailbox(id = "d", role = MailboxRole.DRAFTS),
        )
        assertEquals(
            listOf("i", "d", "s", "t"),
            sortMailboxesForDrawer(shuffled).map { it.id },
        )
    }

    @Test
    fun `user-created folders follow the system ones`() {
        val boxes = listOf(
            mailbox(id = "custom", role = null, name = "Receipts", sortOrder = 0),
            mailbox(id = "inbox", role = MailboxRole.INBOX),
        )
        assertEquals(listOf("inbox", "custom"), sortMailboxesForDrawer(boxes).map { it.id })
    }

    // ── Empty states ──────────────────────────────────────────────────────

    @Test
    fun `empty states match the web wording exactly`() {
        // Same table as emptyStateFor in mail-client.tsx. Divergence here is
        // two products, not one product on two platforms.
        assertEquals("Your inbox is empty", emptyStateFor(MailboxRole.INBOX, false).title)
        assertEquals("New messages will appear here.", emptyStateFor(MailboxRole.INBOX, false).body)
        assertEquals("Trash is empty", emptyStateFor(MailboxRole.TRASH, false).title)
        assertEquals("No drafts", emptyStateFor(MailboxRole.DRAFTS, false).title)
        // Searching overrides the mailbox: the mailbox is not empty, the query
        // matched nothing, and saying "Your inbox is empty" would be false.
        assertEquals("No messages match", emptyStateFor(MailboxRole.INBOX, true).title)
    }

    private fun mailbox(
        id: String = "id",
        role: String?,
        name: String = "Name",
        sortOrder: Int = 0,
        unreadThreads: Int = 0,
        totalThreads: Int = 0,
    ) = Mailbox(
        id = id,
        name = name,
        parentId = null,
        role = role,
        sortOrder = sortOrder,
        totalEmails = totalThreads,
        unreadEmails = unreadThreads,
        totalThreads = totalThreads,
        unreadThreads = unreadThreads,
    )
}
