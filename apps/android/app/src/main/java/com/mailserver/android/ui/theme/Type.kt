package com.mailserver.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The web type scale, in sp.
 *
 * The px values are lifted from `--text-*` in packages/ui/src/theme.css and
 * declared in sp rather than dp, so the whole scale grows with the user's font
 * size setting. A mail client that ignores that setting is unusable for the
 * people who changed it, and the row heights in [RowDensity] are sized to
 * absorb a scale step rather than clip.
 *
 * The web stack leads with Inter and Plus Jakarta Sans. Neither ships with
 * Android, and bundling a variable font is a real decision about APK size that
 * has not been taken yet, so this maps to the platform sans for now. When a
 * font is bundled, only this file changes.
 */
private val Sans = FontFamily.SansSerif

// --text-xs: 11/16   --text-sm: 13/20   --text-base: 14/22
// --text-md: 15/24   --text-lg: 17/26   --text-xl: 20/28
// --text-2xl: 24/32  --text-3xl: 30/36
val MailTypography = Typography(
    displaySmall = TextStyle(fontFamily = Sans, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold),
    headlineMedium = TextStyle(fontFamily = Sans, fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontFamily = Sans, fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontFamily = Sans, fontSize = 17.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontFamily = Sans, fontSize = 15.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium),
    titleSmall = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 15.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontSize = 13.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontFamily = Sans, fontSize = 13.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = Sans, fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
)
