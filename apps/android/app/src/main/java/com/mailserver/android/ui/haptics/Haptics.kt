package com.mailserver.android.ui.haptics

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView

/**
 * Every haptic in the app, named by what it MEANS rather than by how strong it
 * is.
 *
 * The brief asks for a centralised manager, and the reason is not tidiness. A
 * `view.performHapticFeedback(...)` scattered across thirty composables is
 * thirty independent decisions about intensity, and the result is an app that
 * buzzes at everything — which is indistinguishable, to a hand in a pocket,
 * from an app that buzzes at nothing. Naming the intent instead of the effect
 * means the mapping can be tuned in one place and the call sites keep reading
 * correctly.
 *
 * Nothing in the ordinary path of scrolling and reading is in this list. Taps
 * that merely navigate — opening a conversation, switching mailbox — get no
 * haptic at all: navigating is not an event worth confirming through the skin.
 */
enum class Haptic {
    /** A control was pressed and something will happen. Compose, Send button. */
    Press,

    /** A row entered or left the selection. */
    Select,

    /** Long-press crossed into selection mode. Distinctly stronger than [Select]. */
    SelectionStart,

    /** A star was toggled. */
    Toggle,

    /** The drawer opened or closed. */
    Drawer,

    /**
     * A swipe or pull crossed the point where releasing would act.
     *
     * Fires ONCE per crossing, not per frame — see [ThresholdLatch]. A haptic
     * on every pixel past the line is a continuous buzz, not feedback.
     */
    Threshold,

    /** A reversible action completed: archived, moved to trash, marked read. */
    Confirm,

    /** An irreversible action completed: permanently deleted. */
    ConfirmDestructive,

    /** A message left the device for the server. */
    Send,

    /** An operation failed and the user must know without reading. */
    Error,
}

/**
 * Performs haptics, or does nothing when the user has asked for silence.
 *
 * Two independent switches are honoured, and both are checked at the moment of
 * firing rather than cached:
 *
 *  - **The system setting.** `HAPTIC_FEEDBACK_ENABLED` is the OS-wide toggle.
 *    Compose's own `LocalHapticFeedback` does not consult it, so an app built
 *    on that alone keeps vibrating after the user has turned haptics off in
 *    Settings. Checking it here is what makes the app obey.
 *  - **The app setting.** [enabled] is the in-app preference from the Account
 *    screen, for someone who wants a phone that still vibrates for calls but a
 *    mail client that stays quiet.
 *
 * Accessibility services are respected implicitly: the platform constants used
 * here are the ones TalkBack and the OS already gate, so no special case is
 * needed and none is invented.
 */
@Stable
class HapticFeedbackManager(
    private val view: View,
    private val context: Context,
    /** The in-app preference. Read on every call so a change takes effect at once. */
    private val enabled: () -> Boolean,
) {

    fun perform(haptic: Haptic) {
        if (!enabled()) return
        if (!systemHapticsEnabled()) return

        // Deliberately not one constant repeated. The whole point of the enum
        // is that "a row was selected" and "mail was permanently destroyed"
        // must not feel the same.
        val constant = when (haptic) {
            Haptic.Press -> HapticFeedbackConstants.KEYBOARD_TAP
            Haptic.Select -> HapticFeedbackConstants.CLOCK_TICK
            Haptic.SelectionStart -> HapticFeedbackConstants.LONG_PRESS
            Haptic.Toggle -> HapticFeedbackConstants.CLOCK_TICK
            Haptic.Drawer -> HapticFeedbackConstants.CLOCK_TICK
            Haptic.Threshold -> HapticFeedbackConstants.CLOCK_TICK

            // CONFIRM and REJECT exist only from API 30. Below that they fall
            // back to effects that are present on every supported release
            // rather than silently doing nothing, which would leave older
            // devices with no feedback on exactly the operations that matter.
            Haptic.Confirm ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
                else HapticFeedbackConstants.KEYBOARD_TAP

            Haptic.ConfirmDestructive, Haptic.Send ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
                else HapticFeedbackConstants.LONG_PRESS

            Haptic.Error ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT
                else HapticFeedbackConstants.LONG_PRESS
        }

        // FLAG_IGNORE_VIEW_SETTING is NOT passed. That flag overrides the
        // view's own haptic preference, which is the opposite of what a
        // respectful client does.
        view.performHapticFeedback(constant)
    }

    /**
     * The OS-wide haptic toggle.
     *
     * `HAPTIC_FEEDBACK_ENABLED` carries a deprecation marker, and the
     * suppression is deliberate rather than an oversight: the platform
     * deprecated the constant without providing a replacement API for READING
     * the value. It is still the setting the Settings app writes and still the
     * one `View.performHapticFeedback` consults, so honouring it is the only
     * way to obey a user who has turned haptics off system-wide. The moment a
     * supported accessor exists, this is the one place to change.
     *
     * A failure to read it is treated as "enabled", matching the platform
     * default, rather than silently disabling all feedback because one Settings
     * lookup threw on one OEM build.
     */
    @Suppress("DEPRECATION")
    private fun systemHapticsEnabled(): Boolean = runCatching {
        Settings.System.getInt(context.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0
    }.getOrDefault(true)
}

/**
 * A gesture that must fire exactly once when it crosses a line.
 *
 * Swipe and pull-to-refresh both report a continuous distance, and firing a
 * haptic whenever that distance exceeds the activation point means firing on
 * every frame the finger is past it. This latches: the crossing produces one
 * pulse, and moving back below the line re-arms it so a user who hesitates over
 * the threshold feels the boundary each way rather than a continuous vibration.
 */
@Stable
class ThresholdLatch(private val haptics: HapticFeedbackManager) {
    private var past = false

    fun update(isPastThreshold: Boolean) {
        if (isPastThreshold == past) return
        past = isPastThreshold
        // Only the crossing INTO the active zone is announced. Leaving it is a
        // cancellation, and confirming a cancellation is noise.
        if (isPastThreshold) haptics.perform(Haptic.Threshold)
    }

    fun reset() {
        past = false
    }
}

/**
 * The manager for the current composition.
 *
 * No default implementation: a missing provider is a wiring bug that should
 * fail loudly at the first haptic rather than leave a screen mysteriously
 * silent in a way nobody notices until a review.
 */
val LocalHaptics: ProvidableCompositionLocal<HapticFeedbackManager> =
    compositionLocalOf { error("No HapticFeedbackManager provided. Wrap the tree in ProvideHaptics.") }

@Composable
fun rememberHapticFeedbackManager(enabled: () -> Boolean): HapticFeedbackManager {
    val view = LocalView.current
    val context = LocalContext.current
    return remember(view, context) { HapticFeedbackManager(view, context, enabled) }
}
