package com.mailserver.android

import android.app.Application
import com.mailserver.android.data.MailRepository
import com.mailserver.android.data.auth.SessionStore
import com.mailserver.android.data.remote.ApiClient

/**
 * Composition root.
 *
 * A hand-rolled locator rather than Hilt: the graph is four objects deep and a
 * DI framework at this size costs an annotation processor and a build-time hit
 * for indirection nobody needs yet. If the graph grows past what a reader can
 * hold, this becomes the seam where Hilt goes in — every consumer already asks
 * the Application for its dependencies rather than constructing them.
 */
class MailServerApp : Application() {

    lateinit var sessionStore: SessionStore
        private set

    lateinit var repository: MailRepository
        private set

    override fun onCreate() {
        super.onCreate()
        sessionStore = SessionStore(this)

        // BuildConfig.BASE_URL comes from gradle.properties per build type.
        // A release build with no configured URL fails loudly at the first call
        // rather than quietly defaulting to localhost, which would ship an app
        // that talks to nothing.
        val api = ApiClient.create(BuildConfig.BASE_URL, sessionStore)
        repository = MailRepository(api, sessionStore)
    }
}
