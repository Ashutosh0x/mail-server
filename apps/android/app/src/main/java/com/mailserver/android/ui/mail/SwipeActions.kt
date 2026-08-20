package com.mailserver.android.ui.mail

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.mailserver.android.data.model.MessageAction
import com.mailserver.android.ui.haptics.Haptic
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.haptics.ThresholdLatch
import com.mailserver.android.ui.theme.MailTheme
import kotlin.math.abs

/**
 * What a swipe does in a given mailbox.
 *
 * Both directions come from the same per-mailbox policy the toolbar uses, so a
 * swipe cannot mean something the buttons do not offer. Swiping left in Trash
 * must not "archive" — there is nothing to archive out of — and deriving the
 * gesture from [actionsFor] and [deletePolicyFor] is what prevents that from
 * being a separate thing to remember.
 */
data class SwipeActionSpec(
    val action: MessageAction,
    val label: String,
    val icon: ImageVector,
    val destructive: Boolean,
)

/**
 * Swipe right: the read/unread toggle.
 *
 * Chosen because it is the one mailbox action that is its own inverse. A
 * mis-swipe costs one swipe back, so it is safe to make easy, which is exactly
 * what an edge gesture should be.
 */
fun trailingSwipeFor(role: String?, isUnread: Boolean): SwipeActionSpec? = when (role) {
    // A draft was never received, so it has no read state to toggle.
    MailboxRole.DRAFTS -> null
    else -> if (isUnread) {
        SwipeActionSpec(MessageAction.Read, "Mark read", Icons.Filled.MarkEmailRead, destructive = false)
    } else {
        SwipeActionSpec(MessageAction.Unread, "Mark unread", Icons.Filled.MarkEmailUnread, destructive = false)
    }
}

/**
 * Swipe left: the mailbox's filing action.
 *
 * Archive where a conversation can be archived, Delete where it cannot. In
 * Trash, Spam and Drafts this returns null rather than a delete: deletion there
 * is permanent, and §32 is explicit that a destructive-and-irreversible action
 * must not be reachable by a gesture that can be started by accident in a
 * pocket. Those mailboxes delete through the toolbar, with the confirmation.
 */
fun leadingSwipeFor(role: String?): SwipeActionSpec? = when (role) {
    MailboxRole.TRASH, MailboxRole.JUNK, MailboxRole.DRAFTS -> null
    MailboxRole.ARCHIVE ->
        SwipeActionSpec(MessageAction.Trash, "Delete", Icons.Filled.Delete, destructive = true)
    else ->
        SwipeActionSpec(MessageAction.Archive, "Archive", Icons.Filled.Archive, destructive = false)
}

/**
 * A row that can be swiped, with the reveal-then-activate behaviour §32 asks
 * for.
 *
 * The important property is that progress is CONTINUOUS and activation is
 * DISCRETE. As the finger moves, the background action fades and scales in, so
 * the user can see what is about to happen and how close they are to it. The
 * action only fires when the row passes a positional threshold and is released
 * — a short swipe springs back having done nothing, which is what makes the
 * gesture safe to explore.
 *
 * Destructive actions use a longer threshold. Not a different interaction, just
 * a deliberately harder one to reach by accident: [DESTRUCTIVE_THRESHOLD] of
 * the row versus [REVERSIBLE_THRESHOLD].
 *
 * The haptic fires once per crossing via [ThresholdLatch], not once per frame
 * past it. Pulsing every frame is a continuous buzz, which conveys nothing.
 *
 * Nothing here is gesture-only: every action reachable by a swipe is also in
 * the selection toolbar and the conversation's More menu, as §41 requires.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeableRow(
    leading: SwipeActionSpec?,
    trailing: SwipeActionSpec?,
    onAction: (SwipeActionSpec) -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    // With neither direction configured there is no gesture to attach, and
    // wrapping the row in a dismiss box would only cost a layer.
    if (leading == null && trailing == null) {
        Box(modifier) { content() }
        return
    }

    val colors = MailTheme.colors
    val haptics = LocalHaptics.current
    val latch = remember(haptics) { ThresholdLatch(haptics) }

    /**
     * Which way the finger is currently going.
     *
     * Tracked separately because `positionalThreshold` receives only the row
     * width, and the threshold has to depend on the direction: a row can offer
     * a destructive action one way and a harmless one the other, and making the
     * read/unread toggle as hard to reach as a delete would punish the safe
     * gesture for the dangerous one's sake. Updated from `dismissDirection`,
     * which settles as soon as the drag has a sign — long before either
     * threshold is in reach.
     */
    var direction by remember { mutableStateOf(SwipeToDismissBoxValue.Settled) }

    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { target ->
            val spec = specFor(target, leading, trailing)
            if (spec == null) {
                false
            } else {
                haptics.perform(if (spec.destructive) Haptic.ConfirmDestructive else Haptic.Confirm)
                onAction(spec)
                // Always false: the row is NOT dismissed by the gesture. The
                // server decides whether the message leaves this mailbox, and
                // the list re-reads from the server afterwards. Letting the row
                // animate away here would be the client asserting a result it
                // has not been told, and a failed action would leave a hole
                // where a message still is.
                false
            }
        },
        positionalThreshold = { width ->
            width * thresholdFor(specFor(direction, leading, trailing))
        },
    )

    // Announce the crossing, once each way, and keep `direction` current.
    // Read through a snapshotFlow so this follows the drag itself rather than
    // waiting for something else to trigger a recomposition.
    LaunchedEffect(state, latch, leading, trailing) {
        snapshotFlow { Triple(state.progress, state.targetValue, state.dismissDirection) }
            .collect { (progress, target, dragging) ->
                direction = dragging

                // The latch follows the TARGET — where a release would land —
                // rather than the raw drag direction, so the pulse marks the
                // moment the action becomes armed.
                val spec = specFor(target, leading, trailing)
                latch.update(spec != null && progress >= thresholdFor(spec))
            }
    }

    SwipeToDismissBox(
        state = state,
        modifier = modifier,
        enableDismissFromStartToEnd = trailing != null,
        enableDismissFromEndToStart = leading != null,
        backgroundContent = {
            val spec = specFor(state.dismissDirection, leading, trailing)
                ?: return@SwipeToDismissBox

            val threshold = thresholdFor(spec)
            val progress = state.progress.coerceIn(0f, 1f)
            val armed = progress >= threshold

            // The icon grows to full size as the threshold approaches and
            // settles slightly larger once armed, so "released now, this
            // happens" is legible without reading the label.
            val scale by animateFloatAsState(
                targetValue = if (armed) 1f else 0.7f + 0.3f * (progress / threshold).coerceIn(0f, 1f),
                label = "swipe-icon-scale",
            )

            val tint = if (spec.destructive) colors.danger else colors.success
            val background = if (armed) {
                if (spec.destructive) colors.dangerMuted else colors.successMuted
            } else {
                colors.surfaceSunken
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(background)
                    .padding(horizontal = 24.dp),
                contentAlignment = when (state.dismissDirection) {
                    SwipeToDismissBoxValue.StartToEnd -> Alignment.CenterStart
                    else -> Alignment.CenterEnd
                },
            ) {
                Icon(
                    imageVector = spec.icon,
                    // The row itself carries the description. Announcing the
                    // background action too would read the row twice.
                    contentDescription = null,
                    tint = if (armed) tint else colors.inkMuted,
                    modifier = Modifier
                        .size(24.dp)
                        .scale(scale)
                        // Fades in with the drag rather than appearing at full
                        // strength on the first pixel of movement.
                        .alpha(alphaFor(progress)),
                )
            }
        },
        content = { content() },
    )
}

/**
 * Which action a given swipe direction carries.
 *
 * `StartToEnd` is a rightward drag and `EndToStart` a leftward one — and both
 * are mirrored automatically in a right-to-left locale, which is why the
 * parameters are named for the reading direction rather than for left and
 * right. One function so the three places that need this answer — the
 * threshold, the background and the commit — cannot drift apart.
 */
private fun specFor(
    value: SwipeToDismissBoxValue,
    leading: SwipeActionSpec?,
    trailing: SwipeActionSpec?,
): SwipeActionSpec? = when (value) {
    SwipeToDismissBoxValue.StartToEnd -> trailing
    SwipeToDismissBoxValue.EndToStart -> leading
    SwipeToDismissBoxValue.Settled -> null
}

private fun thresholdFor(spec: SwipeActionSpec?): Float =
    if (spec?.destructive == true) DESTRUCTIVE_THRESHOLD else REVERSIBLE_THRESHOLD

/** Below this fraction of the row width, releasing does nothing. */
private const val REVERSIBLE_THRESHOLD = 0.35f

/**
 * Deliberately most of the row.
 *
 * A destructive action a thumb can reach in a short flick is one that gets
 * triggered in a pocket. Making it a committed gesture is the cheapest safety
 * there is.
 */
private const val DESTRUCTIVE_THRESHOLD = 0.6f

/** Opaque well before the threshold, so the action is readable before it arms. */
private fun alphaFor(progress: Float): Float = (abs(progress) / 0.25f).coerceIn(0f, 1f)
