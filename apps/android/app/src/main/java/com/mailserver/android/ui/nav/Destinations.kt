package com.mailserver.android.ui.nav

/**
 * Everywhere the app can go.
 *
 * A sealed set rather than free-form route strings: a typo in a string route is
 * a crash at runtime, and there is no reason for the compiler not to catch it.
 *
 * NOTHING IS LISTED HERE THAT DOES NOT EXIST. The brief asks for a drawer
 * containing Storage, Appearance, Security, Devices, Privacy, Notifications and
 * Help, and those are the right destinations for the finished product — but a
 * drawer row that opens an empty screen is worse than an absent one, because it
 * claims a feature and then disproves it. Each is added here in the phase that
 * builds its screen, and `docs/android/navigation.md` tracks which are still
 * outstanding.
 */
sealed interface Destination {
    val route: String

    /** A mailbox. The id is the server's, never a role name. */
    data class Mail(val mailboxId: String?) : Destination {
        override val route: String get() = if (mailboxId == null) "mail" else "mail/$mailboxId"

        companion object {
            const val PATTERN = "mail?mailboxId={mailboxId}"
            const val ARG = "mailboxId"
        }
    }

    /** One conversation. */
    data class Conversation(val threadId: String) : Destination {
        override val route: String get() = "thread/$threadId"

        companion object {
            const val PATTERN = "thread/{threadId}"
            const val ARG = "threadId"
        }
    }
}

/**
 * A row in the navigation drawer.
 *
 * [count] is null when there is no count to show — which is not the same as
 * zero. Sent has no meaningful unread count, so it shows nothing; an empty
 * Inbox genuinely has zero unread and shows "0". Collapsing those two into one
 * representation is how a UI ends up inventing a number.
 */
data class DrawerItem(
    val id: String,
    val label: String,
    val destination: Destination,
    val count: Int? = null,
    /** Draws the count as attention-worthy rather than incidental. */
    val countIsUnread: Boolean = false,
)

/** A titled group of rows. Groups with no rows are not rendered at all. */
data class DrawerSection(
    val title: String?,
    val items: List<DrawerItem>,
)
