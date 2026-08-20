package com.mailserver.android.ui.inbox

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mailserver.android.data.model.Thread
import com.mailserver.android.ui.haptics.Haptic
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.theme.MailTheme
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * One conversation in the list.
 *
 * Unread is carried by WEIGHT AND COLOUR TOGETHER, never colour alone. §29
 * requires it, and a colour-only signal disappears for a colourblind reader and
 * in bright sunlight.
 *
 * The whole row is a single accessibility node with a composed description.
 * Read field by field, TalkBack announces six disconnected fragments per row,
 * and a mailbox of forty rows becomes 240 fragments to scrub through.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ThreadRow(
    thread: Thread,
    selected: Boolean,
    selectionMode: Boolean,
    onOpen: () -> Unit,
    onToggleSelect: () -> Unit,
    onToggleStar: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MailTheme.colors
    val density = MailTheme.density
    val haptics = LocalHaptics.current
    val latest = thread.latest
    val unread = thread.unreadCount > 0
    // Aliased because `selected` is also the name of the semantics property set
    // below, and inside that scope the parameter would be shadowed.
    val isSelected = selected

    val description = buildString {
        if (unread) append("Unread. ")
        append(latest.displayFrom)
        append(". ")
        append(latest.subject.ifBlank { "No subject" })
        append(". ")
        if (thread.messageCount > 1) append(thread.messageCount).append(" messages. ")
        if (thread.hasAttachment) append("Has attachment. ")
        // The star is its own control below, and announces its own state.
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = density.rowHeightDp.dp)
            .background(if (selected) colors.surfaceSunken else colors.canvas),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The conversation itself: one accessibility node with a composed
        // description. Read field by field, TalkBack announces six disconnected
        // fragments per row, and a mailbox of forty rows becomes 240 fragments to
        // scrub through.
        //
        // The star sits OUTSIDE this node rather than inside it. Clearing or
        // merging the whole row would take the star's own semantics and its click
        // action with it, leaving a control a screen-reader user can see the
        // state of but never operate.
        Row(
            modifier = Modifier
                .weight(1f)
                .combinedClickable(
                    onClick = {
                        // No haptic for plain navigation. Opening a conversation is
                        // not an event that needs confirming through the skin, and
                        // buzzing on every tap is how an app becomes one people
                        // turn haptics off for entirely.
                        if (selectionMode) {
                            haptics.perform(Haptic.Select)
                            onToggleSelect()
                        } else {
                            onOpen()
                        }
                    },
                    onLongClick = {
                        // Distinctly stronger than a selection tap: this is the
                        // gesture that CHANGES MODE, and the pulse is what tells a
                        // user their long press registered before the bar animates.
                        haptics.perform(Haptic.SelectionStart)
                        onToggleSelect()
                    },
                )
                .padding(start = 16.dp, top = 10.dp, bottom = 10.dp)
                .clearAndSetSemantics {
                    contentDescription = description
                    // In selection mode the row IS the checkbox. A bare button
                    // announces only its label, so a screen-reader user would hear
                    // the subject with no way to know it was already selected —
                    // the same defect the web client fixed in its row control.
                    if (selectionMode) {
                        role = Role.Checkbox
                        this.selected = isSelected
                    } else {
                        role = Role.Button
                    }
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Avatar, replaced in place by a selection tick so the row does not
            // reflow when selection mode turns on.
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(if (selected) MaterialTheme.colorScheme.primary else colors.surfaceSunken),
                contentAlignment = Alignment.Center,
            ) {
                if (selected) {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(20.dp),
                    )
                } else {
                    Text(
                        text = latest.displayFrom.take(1).uppercase(),
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.inkSecondary,
                    )
                }
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = latest.displayFrom,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (unread) colors.unread else colors.read,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (thread.messageCount > 1) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = thread.messageCount.toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.inkMuted,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = formatTimestamp(latest.receivedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (unread) colors.ink else colors.inkMuted,
                    )
                }

                Text(
                    text = latest.subject.ifBlank { "(no subject)" },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (unread) FontWeight.Medium else FontWeight.Normal,
                    color = if (unread) colors.unread else colors.read,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        // The server's own snippet, already truncated. Not rebuilt
                        // from the body, which the list deliberately never fetches.
                        text = latest.preview,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (thread.hasAttachment) {
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.Filled.AttachFile,
                            contentDescription = null,
                            tint = colors.attachment,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
            }

            }
        // ── end of the conversation node ──────────────────────────────────

        /**
         * The star.
         *
         * A real 48dp target — the platform minimum — even though the glyph is
         * 20dp, because a star that needs aiming for is one people stop using.
         *
         * The state is [latest.isStarred], which is the server's `$flagged`
         * keyword and nothing else. There is no local optimistic flip here: the
         * caller applies the action, the list re-reads, and the icon follows
         * what came back. A star that turns gold and stays gold after the
         * server refused it is the app lying about the account's state, which
         * §55 rules out explicitly.
         */
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .clickable(
                    onClick = {
                        haptics.perform(Haptic.Toggle)
                        onToggleStar()
                    },
                    role = Role.Checkbox,
                    onClickLabel = if (latest.isStarred) "Remove star" else "Add star",
                )
                .semantics { this.selected = latest.isStarred },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (latest.isStarred) Icons.Filled.Star else Icons.Filled.StarBorder,
                contentDescription = if (latest.isStarred) "Starred" else "Not starred",
                tint = if (latest.isStarred) colors.starred else colors.inkDisabled,
                modifier = Modifier.size(20.dp),
            )
        }

        Spacer(Modifier.width(4.dp))
    }
}

/**
 * Relative for recent mail, absolute beyond a week.
 *
 * An unparseable value renders as the empty string rather than as a guessed
 * date. A wrong date on a message is worse than no date.
 */
internal fun formatTimestamp(iso: String): String = runCatching {
    val zone = ZoneId.systemDefault()
    val then = Instant.parse(iso).atZone(zone)
    val now = ZonedDateTime.now(zone)

    when {
        then.toLocalDate() == now.toLocalDate() ->
            then.format(DateTimeFormatter.ofPattern("HH:mm"))
        then.toLocalDate().isAfter(now.toLocalDate().minusDays(7)) ->
            then.format(DateTimeFormatter.ofPattern("EEE"))
        then.year == now.year ->
            then.format(DateTimeFormatter.ofPattern("d MMM"))
        else ->
            then.format(DateTimeFormatter.ofPattern("d MMM yyyy"))
    }
}.getOrDefault("")
