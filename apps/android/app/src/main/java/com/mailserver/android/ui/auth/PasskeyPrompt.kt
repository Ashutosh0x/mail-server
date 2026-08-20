package com.mailserver.android.ui.auth

import android.content.Context
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.mailserver.android.data.auth.PasskeySupport
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * The platform half of a passkey sign-in.
 *
 * Kept out of the ViewModel because Credential Manager needs an **Activity**
 * context to show its sheet, and a ViewModel holding one would leak it across
 * every rotation. The ViewModel gets the challenge and consumes the result; the
 * bit in between belongs here.
 *
 * The server's options go in as JSON and the authenticator's response comes
 * back as JSON, both untouched. Nothing here parses or rebuilds a WebAuthn
 * structure: the fields are base64url and their exact encoding is what the
 * signature covers, so a round trip through a hand-written model is a chance to
 * change a byte that must not change.
 */
object PasskeyPrompt {

    /** What came back from the system sheet. */
    sealed interface Outcome {
        data class Success(val assertion: JsonElement) : Outcome

        /**
         * The user dismissed the sheet.
         *
         * Distinct from [Failed] on purpose: cancelling is a decision, not an
         * error, and reporting it as one tells someone their deliberate action
         * went wrong. The web client swallows `NotAllowedError` for the same
         * reason.
         */
        data object Cancelled : Outcome

        data class Failed(val message: String) : Outcome
    }

    /**
     * Show the system passkey sheet for [optionsJson].
     *
     * Suspends until the user chooses or dismisses. [context] must be an
     * Activity context.
     */
    suspend fun authenticate(context: Context, optionsJson: JsonElement): Outcome {
        val request = GetCredentialRequest(
            listOf(GetPublicKeyCredentialOption(requestJson = optionsJson.toString()))
        )

        return try {
            val response = PasskeySupport.credentialManager(context)
                .getCredential(context, request)

            val credential = response.credential
            if (credential !is PublicKeyCredential) {
                // A provider returned something that is not a passkey. Reported
                // rather than cast, because forcing it would crash on a device
                // whose credential manager behaves differently.
                return Outcome.Failed("That credential is not a passkey.")
            }

            Outcome.Success(Json.parseToJsonElement(credential.authenticationResponseJson))
        } catch (e: GetCredentialCancellationException) {
            Outcome.Cancelled
        } catch (e: NoCredentialException) {
            // The single most common real failure, and the one whose default
            // message ("no credential available") sends people looking for a
            // bug. Named for what it means to the user instead.
            Outcome.Failed("No passkey was available for this server on this device.")
        } catch (e: GetCredentialException) {
            // Deliberately not `e.message`, which is frequently a provider
            // string like "Failed to decrypt" — accurate to the platform and
            // meaningless to a person. The failure is not silently swallowed:
            // the type is in logcat via the caller.
            Outcome.Failed("That passkey could not be used. Try your password instead.")
        }
    }
}
