package com.mailserver.android.ui.nav

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Drafts
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Report
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mailserver.android.data.model.Label
import com.mailserver.android.data.model.Mailbox
import com.mailserver.android.data.model.SessionUser
import com.mailserver.android.ui.haptics.Haptic
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.mail.MailboxRole
import com.mailserver.android.ui.mail.drawerCountFor
import com.mailserver.android.ui.mail.sortMailboxesForDrawer
import com.mailserver.android.ui.theme.MailTheme

/**
 * The navigation drawer.
 *
 * Everything in it comes from the server. The mailbox list is the account's
 * real mailboxes in the web sidebar's order, the counts are the server's
 * `unreadThreads` and `totalThreads`, and the labels are the account's real
 * labels — an account with no labels gets no LABELS heading rather than an
 * empty section implying it should have some.
 *
 * The sections the brief describes but that do not exist yet (Storage,
 * Appearance, Security, Devices, Notifications, Help) are deliberately absent
 * rather than present-and-inert. A row that opens nothing is a feature claim
 * the app then disproves, which is worse than not claiming it; they arrive with
 * their screens.
 */
@Composable
fun MailDrawerSheet(
    user: SessionUser?,
    mailboxes: List<Mailbox>,
    labels: List<Label>,
    selectedMailboxId: String?,
    onSelectMailbox: (String) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MailTheme.colors
    val haptics = LocalHaptics.current

    ModalDrawerSheet(
        modifier = modifier,
        drawerContainerColor = colors.surface,
    ) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {

            AccountHeader(user)

            HorizontalDivider(color = colors.borderMuted)
            Spacer(Modifier.height(8.dp))

            SectionTitle("Mail")

            // Sorted to the web sidebar's order. A mailbox the server did not
            // send simply is not here — the drawer lists this account's
            // mailboxes, not a fixed menu with dead entries.
            sortMailboxesForDrawer(mailboxes).forEach { mailbox ->
                val count = drawerCountFor(mailbox)
                val unread = mailbox.role != MailboxRole.DRAFTS

                DrawerRow(
                    label = mailbox.name,
                    icon = iconFor(mailbox.role),
                    count = count,
                    countIsUnread = unread,
                    selected = mailbox.id == selectedMailboxId,
                    onClick = {
                        haptics.perform(Haptic.Drawer)
                        onSelectMailbox(mailbox.id)
                    },
                )
            }

            // No heading and no divider when the account has no labels. An
            // empty "ORGANIZE" section suggests something is missing.
            if (labels.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                SectionTitle("Labels")

                labels.forEach { label ->
                    DrawerRow(
                        label = label.name,
                        icon = Icons.AutoMirrored.Filled.Label,
                        count = null,
                        countIsUnread = false,
                        selected = false,
                        // Label filtering is a Phase 4 route. Until it exists
                        // the row is not interactive, because a row that
                        // highlights and then does nothing reads as a bug.
                        onClick = null,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = colors.borderMuted)
            Spacer(Modifier.height(8.dp))

            DrawerRow(
                label = "Sign out",
                icon = Icons.Outlined.Delete,
                count = null,
                countIsUnread = false,
                selected = false,
                onClick = {
                    haptics.perform(Haptic.Press)
                    onSignOut()
                },
            )

            Spacer(Modifier.height(12.dp))
        }
    }
}

/**
 * Who is signed in.
 *
 * The avatar is the first letter of the display name or the address — never a
 * generated identicon or a stock silhouette, both of which are the client
 * asserting something about a person the server never said.
 *
 * `user` being null is a real state during the cold-start session probe. The
 * header collapses to nothing rather than rendering a placeholder name that
 * would then change under the user's eyes.
 */
@Composable
private fun AccountHeader(user: SessionUser?) {
    if (user == null) return
    val colors = MailTheme.colors

    val display = user.displayName?.takeIf(String::isNotBlank) ?: user.email
    val initial = display.firstOrNull()?.uppercaseChar()?.toString() ?: "?"

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(MaterialTheme.colorScheme.primaryContainer, CircleShape)
                // The letter is decoration once the name is read out beside it;
                // announcing "A" before the name is noise for a screen reader.
                .clearAndSetSemantics { },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initial,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = display,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // Not repeated when the display name IS the address.
            if (display != user.email) {
                Text(
                    text = user.email,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.inkMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = MailTheme.colors.inkMuted,
        modifier = Modifier.padding(start = 28.dp, end = 20.dp, top = 8.dp, bottom = 4.dp),
    )
}

/**
 * One drawer row.
 *
 * [onClick] null renders the row as present but not actionable, for a
 * destination whose screen has not been built. It is not disabled-looking
 * theatre: it simply does not respond, and it does not claim a state it cannot
 * enter.
 *
 * The count is announced as part of the row's description rather than as a
 * separate node, so TalkBack reads "Inbox, 4 unread" as one item instead of
 * stopping on a bare "4".
 */
@Composable
private fun DrawerRow(
    label: String,
    icon: ImageVector,
    count: Int?,
    countIsUnread: Boolean,
    selected: Boolean,
    onClick: (() -> Unit)?,
) {
    val colors = MailTheme.colors

    val description = when {
        count == null -> label
        countIsUnread -> "$label, $count unread"
        else -> "$label, $count"
    }

    NavigationDrawerItem(
        modifier = Modifier
            .padding(NavigationDrawerItemDefaults.ItemPadding)
            .semantics { contentDescription = description },
        selected = selected,
        onClick = onClick ?: {},
        icon = { Icon(icon, contentDescription = null) },
        label = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = label,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    // The selected mailbox is bold; an unread count does not
                    // bolden the row, because the row name is not the thing
                    // that is unread.
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    modifier = Modifier.weight(1f, fill = false),
                )

                // Zero IS shown when the server reported zero — that is a fact
                // about the mailbox. Null means the server has no count to give
                // for this row, and nothing is drawn.
                if (count != null) {
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = count.toString(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (countIsUnread && count > 0) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (countIsUnread && count > 0) colors.ink else colors.inkMuted,
                    )
                }
            }
        },
        colors = NavigationDrawerItemDefaults.colors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            selectedTextColor = colors.ink,
            selectedIconColor = MaterialTheme.colorScheme.primary,
            unselectedTextColor = colors.inkSecondary,
            unselectedIconColor = colors.inkMuted,
        ),
    )
}

/**
 * The icon for a mailbox ROLE, never for its name.
 *
 * A server may present the inbox as "Posteingang"; matching on the display name
 * would silently fail for every non-English deployment. A user-created folder
 * has no role and gets the generic folder icon, which is honest — the app does
 * not know what is in it.
 */
private fun iconFor(role: String?): ImageVector = when (role) {
    MailboxRole.INBOX -> Icons.Filled.Inbox
    MailboxRole.DRAFTS -> Icons.Filled.Drafts
    MailboxRole.SENT -> Icons.AutoMirrored.Filled.Send
    MailboxRole.ARCHIVE -> Icons.Filled.Archive
    MailboxRole.JUNK -> Icons.Filled.Report
    MailboxRole.TRASH -> Icons.Outlined.Delete
    else -> Icons.Filled.Folder
}
