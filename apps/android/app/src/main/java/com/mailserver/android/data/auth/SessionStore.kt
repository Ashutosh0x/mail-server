package com.mailserver.android.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Where the session cookie lives.
 *
 * The server's session token is bearer-equivalent: anyone holding the value of
 * `mf_session` is the user until it expires or is revoked. `httpOnly` protects
 * it from page scripts in a browser and means nothing here, so the protection
 * has to be storage-side.
 *
 * EncryptedSharedPreferences, keyed by an AES256-GCM master key held in the
 * Android Keystore. The key material never enters the app process — it lives in
 * the TEE or StrongBox where the device has one — so a readable backup or an
 * `adb` pull of the app's data directory yields ciphertext.
 *
 * §4 of the brief forbids plain SharedPreferences for exactly this value. The
 * file is also excluded from cloud backup and device transfer in
 * data_extraction_rules.xml, because an encrypted-at-rest token that is
 * restored onto another device is still a session on another device.
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** The raw `mf_session` value, or null when signed out. */
    var sessionCookie: String?
        get() = prefs.getString(KEY_SESSION, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_SESSION) else putString(KEY_SESSION, value)
        }.apply()

    /**
     * When the cookie stops being accepted, as epoch millis.
     *
     * Stored so the app can stop making authenticated calls it knows will fail,
     * rather than discovering expiry through a 401 on every request. It is a
     * hint, never an authority: the server decides, and a session can be
     * revoked long before this passes.
     */
    var expiresAtMillis: Long
        get() = prefs.getLong(KEY_EXPIRES, 0L)
        set(value) = prefs.edit().putLong(KEY_EXPIRES, value).apply()

    /** The account this cookie belongs to, for the signed-out screen only. */
    var lastKnownEmail: String?
        get() = prefs.getString(KEY_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_EMAIL, value).apply()

    val hasSession: Boolean get() = sessionCookie != null

    /**
     * True when the stored cookie is past its own stated expiry.
     *
     * Deliberately conservative: a zero expiry means "unknown", which counts as
     * NOT expired, so a missing hint never signs a working session out.
     */
    val looksExpired: Boolean
        get() = expiresAtMillis in 1 until System.currentTimeMillis()

    fun clear() {
        prefs.edit().remove(KEY_SESSION).remove(KEY_EXPIRES).apply()
    }

    private companion object {
        const val FILE_NAME = "mailserver_session"
        const val KEY_SESSION = "mf_session"
        const val KEY_EXPIRES = "expires_at"
        const val KEY_EMAIL = "last_email"
    }
}
