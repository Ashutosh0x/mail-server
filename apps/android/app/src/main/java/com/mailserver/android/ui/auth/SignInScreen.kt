package com.mailserver.android.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mailserver.android.ui.haptics.Haptic
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.theme.MailTheme

/**
 * Sign in, or create an account.
 *
 * The wording is the web client's, verbatim — "Use the address and password for
 * this server", "No account on this server? Create one". Two products that
 * phrase the same screen differently read as two products, and the whole point
 * of the brief is that this is one.
 *
 * The password rule is stated up front rather than after a rejected submit,
 * for the reason given in auth-screen.tsx: telling someone their password is
 * wrong only once they have chosen it is how you get "Password1!" on the
 * second attempt.
 *
 * There is no "Forgot password". Not an omission — the server has no
 * password-reset endpoint and the web client offers no such link either, so a
 * button here would lead nowhere. See docs/android/security.md.
 */
@Composable
fun SignInScreen(
    form: SignInForm,
    passkeysSupported: Boolean,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onDisplayNameChange: (String) -> Unit,
    onToggleMode: () -> Unit,
    onSubmit: () -> Unit,
    onPasskeySignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MailTheme.colors
    val haptics = LocalHaptics.current
    val focus = LocalFocusManager.current
    val registering = form.mode == AuthMode.Register

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(colors.canvas)
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 400.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
        ) {
            // Wordmark, matching the web's inbox glyph beside the product name.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.Inbox,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Mail Server",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.ink,
                )
            }

            Spacer(Modifier.height(28.dp))

            Text(
                text = if (registering) "Create your account" else "Sign in",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = colors.ink,
            )
            Text(
                text = if (registering) {
                    "Your mailbox starts empty — nothing is pre-filled."
                } else {
                    "Use the address and password for this server."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = colors.inkMuted,
                modifier = Modifier.padding(top = 4.dp),
            )

            Spacer(Modifier.height(24.dp))

            if (registering) {
                Field(label = "Your name") {
                    OutlinedTextField(
                        value = form.displayName,
                        onValueChange = onDisplayNameChange,
                        singleLine = true,
                        enabled = !form.busy,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(
                            capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Words,
                            imeAction = ImeAction.Next,
                        ),
                        keyboardActions = KeyboardActions(
                            onNext = { focus.moveFocus(FocusDirection.Down) }
                        ),
                    )
                }
                Spacer(Modifier.height(12.dp))
            }

            Field(label = "Email address") {
                OutlinedTextField(
                    value = form.email,
                    onValueChange = onEmailChange,
                    singleLine = true,
                    enabled = !form.busy,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    keyboardActions = KeyboardActions(
                        onNext = { focus.moveFocus(FocusDirection.Down) }
                    ),
                )
            }

            Spacer(Modifier.height(12.dp))

            Field(
                label = "Password",
                // The rule, before it can be broken.
                hint = if (registering) "At least ${SignInForm.MIN_PASSWORD} characters." else null,
                hintIsError = form.passwordTooShort,
            ) {
                var visible by remember { mutableStateOf(false) }
                OutlinedTextField(
                    value = form.password,
                    onValueChange = onPasswordChange,
                    singleLine = true,
                    enabled = !form.busy,
                    isError = form.passwordTooShort,
                    modifier = Modifier.fillMaxWidth(),
                    visualTransformation = if (visible) VisualTransformation.None
                                           else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        // Go, not Next: this is the last field in both modes.
                        imeAction = ImeAction.Go,
                    ),
                    keyboardActions = KeyboardActions(
                        onGo = {
                            focus.clearFocus()
                            if (form.canSubmit) onSubmit()
                        }
                    ),
                    trailingIcon = {
                        IconButton(onClick = { visible = !visible }) {
                            Icon(
                                imageVector = if (visible) Icons.Filled.VisibilityOff
                                              else Icons.Filled.Visibility,
                                // Describes what the button DOES, not what it
                                // shows — "eye icon" tells a screen-reader user
                                // nothing about the outcome of pressing it.
                                contentDescription = if (visible) "Hide password" else "Show password",
                            )
                        }
                    },
                )
            }

            // Announced when it appears, rather than sitting silently on screen
            // for a screen-reader user who has already moved focus past it.
            form.error?.let { message ->
                Spacer(Modifier.height(12.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.dangerMuted, RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .semantics { liveRegion = LiveRegionMode.Assertive },
                ) {
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.danger,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = {
                    haptics.perform(Haptic.Press)
                    focus.clearFocus()
                    onSubmit()
                },
                enabled = form.canSubmit,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                if (form.submitting) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (registering) "Create account" else "Sign in")
            }

            // Passkeys only where they can actually work. The web hides this on
            // a non-secure origin for the same reason: a button that could only
            // fail is worse than no button. See PasskeySupport for the checks.
            if (!registering && passkeysSupported) {
                Spacer(Modifier.height(20.dp))

                Row(verticalAlignment = Alignment.CenterVertically) {
                    HorizontalDivider(modifier = Modifier.weight(1f), color = colors.border)
                    Text(
                        "or",
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.inkMuted,
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                    HorizontalDivider(modifier = Modifier.weight(1f), color = colors.border)
                }

                Spacer(Modifier.height(20.dp))

                OutlinedButton(
                    onClick = {
                        haptics.perform(Haptic.Press)
                        focus.clearFocus()
                        onPasskeySignIn()
                    },
                    enabled = !form.busy,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    if (form.passkeyInFlight) {
                        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                    } else {
                        Icon(Icons.Filled.Fingerprint, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(8.dp))
                    Text("Sign in with a passkey")
                }

                Text(
                    text = "Uses your fingerprint, face or device PIN. Leave the address " +
                        "blank to pick from the passkeys saved on this device.",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.inkMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }

            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (registering) "Already have an account? " else "No account on this server? ",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.inkMuted,
                )
                TextButton(
                    onClick = {
                        haptics.perform(Haptic.Press)
                        onToggleMode()
                    },
                    enabled = !form.busy,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp),
                ) {
                    Text(
                        text = if (registering) "Sign in" else "Create one",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

/**
 * A labelled field.
 *
 * The label is a real `Text` above the input rather than a floating
 * placeholder, matching the web. A placeholder that becomes the label vanishes
 * once the field has content, which is exactly when someone re-reading a form
 * needs it.
 */
@Composable
private fun Field(
    label: String,
    hint: String? = null,
    hintIsError: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colors = MailTheme.colors
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            color = colors.inkSecondary,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        content()
        hint?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelSmall,
                color = if (hintIsError) colors.danger else colors.inkMuted,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
