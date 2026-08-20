package com.mailserver.android.data.remote

import com.mailserver.android.data.auth.SessionStore
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * Holds the server's session cookie across process death.
 *
 * The Mail Server issues `mf_session` as an httpOnly cookie and reads the
 * caller's identity from nothing else (see currentUser() in
 * apps/web/lib/server/auth.ts). A native client authenticates by keeping that
 * cookie and replaying it — which is why this exists instead of an
 * Authorization header the server would ignore.
 *
 * Only `mf_session` is persisted. Anything else the server sets is kept for the
 * process lifetime but not written to disk: persisting cookies we do not
 * understand would mean storing whatever a future middleware happens to set,
 * including things that should not outlive a session.
 */
class SessionCookieJar(private val store: SessionStore) : CookieJar {

    /** Non-session cookies, in memory only, cleared when the process dies. */
    private val volatile = mutableMapOf<String, Cookie>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            if (cookie.name == SESSION_COOKIE) {
                // An empty value with a past expiry is how a server deletes a
                // cookie. Treat it as a sign-out rather than storing "".
                if (cookie.value.isEmpty() || cookie.expiresAt < System.currentTimeMillis()) {
                    store.clear()
                } else {
                    store.sessionCookie = cookie.value
                    store.expiresAtMillis = cookie.expiresAt
                }
            } else {
                volatile[cookie.name] = cookie
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val out = ArrayList<Cookie>(volatile.size + 1)

        store.sessionCookie?.let { value ->
            out += Cookie.Builder()
                .name(SESSION_COOKIE)
                .value(value)
                .domain(url.host)
                .path("/")
                // httpOnly and secure are not re-asserted here: they are
                // instructions to a browser about a cookie it stores, and this
                // jar is the store. Marking it secure would drop it on the
                // plain-HTTP development server for no gain, since the release
                // network config already forbids cleartext outright.
                .build()
        }

        out += volatile.values.filter { it.matches(url) }
        return out
    }

    fun clear() {
        volatile.clear()
        store.clear()
    }

    private companion object {
        /** Must match SESSION_COOKIE in apps/web/lib/server/auth.ts. */
        const val SESSION_COOKIE = "mf_session"
    }
}
