package com.mailserver.android.data.auth

import android.content.Context
import android.os.Build
import androidx.credentials.CredentialManager

/**
 * Whether a passkey sign-in can actually succeed here.
 *
 * The web client asks `window.isSecureContext` and hides the passkey button
 * when the answer is no, precisely so that "the button never appears where it
 * could only fail". This is the Android translation of that check, and it has
 * to test more things because Android's requirements are stricter than a
 * browser's.
 *
 * All three must hold:
 *
 * 1. **API 28+.** Credential Manager's passkey support does not exist below it.
 *
 * 2. **The server is HTTPS.** WebAuthn requires a secure origin, exactly as in
 *    the browser. A debug build pointed at `http://192.168.x.x:3000` fails this
 *    and correctly hides the button.
 *
 * 3. **The origin is a domain, not an IP.** An RP ID must be a registrable
 *    domain; an IP address cannot be one, so `https://192.168.0.103` is out
 *    even though it is HTTPS.
 *
 * There is a fourth requirement this code CANNOT check, and it is the one that
 * bites in production: the server must serve a Digital Asset Links file at
 * `https://<rpId>/.well-known/assetlinks.json` naming this app's package and
 * signing-certificate fingerprint. Without it Credential Manager refuses the
 * request at the platform level. It is unverifiable from inside the app before
 * the fact — the failure surfaces only when the call is made — so it is
 * documented in `docs/android/security.md` rather than guessed at here.
 *
 * Deliberately NOT checked: whether the device has a screen lock or any
 * enrolled credential. Credential Manager prompts to create one, and
 * pre-screening for it would hide the feature from someone who would happily
 * have set it up.
 */
object PasskeySupport {

    /**
     * True when the passkey affordance should be shown at all.
     *
     * [baseUrl] is `BuildConfig.BASE_URL`, passed in rather than read here so
     * this stays a pure function that a unit test can drive.
     */
    fun isAvailable(baseUrl: String): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && isSecureWebAuthnOrigin(baseUrl)

    /**
     * An HTTPS origin whose host is a registrable domain.
     *
     * `localhost` is accepted over plain HTTP for the same reason browsers
     * accept it: it is a trustworthy origin by definition. It only matters for
     * an app running against a server on the device itself, which is rare, but
     * excluding it would be a difference from the web client with no reason
     * behind it.
     */
    internal fun isSecureWebAuthnOrigin(baseUrl: String): Boolean {
        val url = runCatching { java.net.URI(baseUrl) }.getOrNull() ?: return false
        val host = url.host?.lowercase() ?: return false

        if (host == "localhost") return true
        if (!url.scheme.equals("https", ignoreCase = true)) return false

        // An RP ID must be a registrable domain. A bare IP literal is not one,
        // and a single-label host has no registrable suffix to be validated
        // against, so neither can carry an assetlinks association.
        if (host.isIpLiteral()) return false
        return host.contains('.')
    }

    private fun String.isIpLiteral(): Boolean {
        // IPv6 arrives from URI.getHost() wrapped in brackets.
        if (startsWith("[") && endsWith("]")) return true
        val parts = split('.')
        return parts.size == 4 && parts.all { part ->
            part.isNotEmpty() && part.all(Char::isDigit) && part.toIntOrNull()?.let { it in 0..255 } == true
        }
    }

    fun credentialManager(context: Context): CredentialManager = CredentialManager.create(context)
}
