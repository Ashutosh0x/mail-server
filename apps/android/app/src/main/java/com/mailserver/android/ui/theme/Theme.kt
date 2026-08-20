package com.mailserver.android.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * The Mail Server theme, mapped from the web product's tokens.
 *
 * Two deliberate decisions.
 *
 * NO DYNAMIC COLOUR. Material You would repaint the app from the user's
 * wallpaper, which is a different visual identity every time and is precisely
 * what "keep visual consistency with the web product" rules out. The palette
 * is the product's, not the wallpaper's.
 *
 * MATERIAL 3 IS THE MECHANISM, NOT THE PALETTE. The tokens map onto
 * `ColorScheme` so every stock Material component is themed for free, and the
 * mail-specific tokens that have no Material equivalent — unread, read,
 * starred, attachment, the label colours — travel alongside in
 * [MailColors] rather than being bent into a Material slot they do not mean.
 */

@Immutable
data class MailColors(
    val canvas: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val surfaceSunken: Color,
    val border: Color,
    val borderMuted: Color,
    val borderStrong: Color,
    val ink: Color,
    val inkSecondary: Color,
    val inkMuted: Color,
    val inkDisabled: Color,
    /** A row the user has not opened. Weightier than [read] on purpose. */
    val unread: Color,
    val read: Color,
    val starred: Color,
    val attachment: Color,
    val success: Color,
    val successMuted: Color,
    val warning: Color,
    val warningMuted: Color,
    val danger: Color,
    val dangerMuted: Color,
    val info: Color,
    val infoMuted: Color,
)

private val LightMailColors = MailColors(
    canvas = canvasLight,
    surface = surfaceLight,
    surfaceRaised = surfaceRaisedLight,
    surfaceSunken = surfaceSunkenLight,
    border = borderLight,
    borderMuted = borderMutedLight,
    borderStrong = borderStrongLight,
    ink = inkLight,
    inkSecondary = inkSecondaryLight,
    inkMuted = inkMutedLight,
    inkDisabled = inkDisabledLight,
    unread = unreadLight,
    read = readLight,
    starred = starredLight,
    attachment = attachmentLight,
    success = successLight,
    successMuted = successMutedLight,
    warning = warningLight,
    warningMuted = warningMutedLight,
    danger = dangerLight,
    dangerMuted = dangerMutedLight,
    info = infoLight,
    infoMuted = infoMutedLight,
)

private val DarkMailColors = MailColors(
    canvas = canvasDark,
    surface = surfaceDark,
    surfaceRaised = surfaceRaisedDark,
    surfaceSunken = surfaceSunkenDark,
    border = borderDark,
    borderMuted = borderMutedDark,
    borderStrong = borderStrongDark,
    ink = inkDark,
    inkSecondary = inkSecondaryDark,
    inkMuted = inkMutedDark,
    inkDisabled = inkDisabledDark,
    unread = unreadDark,
    read = readDark,
    starred = starredDark,
    attachment = attachmentDark,
    success = successDark,
    successMuted = successMutedDark,
    warning = warningDark,
    warningMuted = warningMutedDark,
    danger = dangerDark,
    dangerMuted = dangerMutedDark,
    info = infoDark,
    infoMuted = infoMutedDark,
)

val LocalMailColors = staticCompositionLocalOf { LightMailColors }

private val LightScheme = lightColorScheme(
    primary = primaryLight,
    onPrimary = primaryInkLight,
    primaryContainer = primaryMutedLight,
    onPrimaryContainer = inkLight,
    background = canvasLight,
    onBackground = inkLight,
    surface = surfaceRaisedLight,
    onSurface = inkLight,
    surfaceVariant = surfaceLight,
    onSurfaceVariant = inkSecondaryLight,
    outline = borderStrongLight,
    outlineVariant = borderLight,
    error = dangerLight,
    onError = Color.White,
    errorContainer = dangerMutedLight,
    onErrorContainer = dangerInkLight,
)

private val DarkScheme = darkColorScheme(
    primary = primaryDark,
    onPrimary = primaryInkDark,
    primaryContainer = primaryMutedDark,
    onPrimaryContainer = inkDark,
    background = canvasDark,
    onBackground = inkDark,
    surface = surfaceRaisedDark,
    onSurface = inkDark,
    surfaceVariant = surfaceDark,
    onSurfaceVariant = inkSecondaryDark,
    outline = borderStrongDark,
    outlineVariant = borderDark,
    error = dangerDark,
    onError = Color.Black,
    errorContainer = dangerMutedDark,
    onErrorContainer = dangerInkDark,
)

/**
 * Row density. The web product offers several; on a touch screen only two are
 * defensible, because anything tighter than [Compact] puts the row below the
 * 48dp minimum touch target and stops being reachable rather than merely
 * looking dense.
 */
enum class RowDensity(val rowHeightDp: Int) {
    Compact(64),
    Comfortable(80),
}

val LocalRowDensity = staticCompositionLocalOf { RowDensity.Comfortable }

@Composable
fun MailServerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    density: RowDensity = RowDensity.Comfortable,
    content: @Composable () -> Unit,
) {
    val scheme = if (darkTheme) DarkScheme else LightScheme
    val mailColors = if (darkTheme) DarkMailColors else LightMailColors

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    CompositionLocalProvider(
        LocalMailColors provides mailColors,
        LocalRowDensity provides density,
    ) {
        MaterialTheme(
            colorScheme = scheme,
            typography = MailTypography,
            content = content,
        )
    }
}

/** Shorthand: `MailTheme.colors.unread` rather than reaching for the local. */
object MailTheme {
    val colors: MailColors
        @Composable get() = LocalMailColors.current
    val density: RowDensity
        @Composable get() = LocalRowDensity.current
}
