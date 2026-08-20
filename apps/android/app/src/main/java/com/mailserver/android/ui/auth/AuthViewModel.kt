package com.mailserver.android.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mailserver.android.data.MailRepository
import com.mailserver.android.data.auth.SessionStore
import com.mailserver.android.data.model.SessionUser
import com.mailserver.android.data.remote.ApiError
import com.mailserver.android.data.remote.ApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/** Where the app is with respect to having a usable session. */
sealed interface AuthState {
    /** Cold start: asking the server whether the stored cookie still works. */
    data object Resolving : AuthState
    data object SignedOut : AuthState
    data class SignedIn(val user: SessionUser) : AuthState
}

/**
 * Sign in, or create an account.
 *
 * One screen with two modes rather than two screens, matching the web client.
 * The alternative — a separate register route — makes "I do not have an
 * account" a navigation problem at the exact moment someone is least willing to
 * hunt for a link.
 */
enum class AuthMode { SignIn, Register }

data class SignInForm(
    val mode: AuthMode = AuthMode.SignIn,
    val email: String = "",
    val password: String = "",
    /** Register only. Goes into a mail header, so the server rejects line breaks. */
    val displayName: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
    /** Set when the server rate-limited this address. */
    val lockedOut: Boolean = false,
    /** True while the system passkey sheet is up. */
    val passkeyInFlight: Boolean = false,
) {
    val busy: Boolean get() = submitting || passkeyInFlight

    /**
     * The server's own minimum, stated up front.
     *
     * Telling someone their password is too short only after they have chosen
     * it is how you get a second attempt that is barely different. Mirrors
     * `passwordProblem` in apps/web/lib/server/validate.ts — if that changes,
     * this is wrong and the server will be the one to say so.
     */
    val passwordTooShort: Boolean
        get() = mode == AuthMode.Register && password.isNotEmpty() && password.length < MIN_PASSWORD

    val canSubmit: Boolean
        get() = !busy &&
            email.isNotBlank() &&
            password.isNotEmpty() &&
            when (mode) {
                AuthMode.SignIn -> true
                AuthMode.Register -> displayName.isNotBlank() && password.length >= MIN_PASSWORD
            }

    companion object {
        const val MIN_PASSWORD = 12
    }
}

class AuthViewModel(
    private val repository: MailRepository,
    private val store: SessionStore,
) : ViewModel() {

    private val _state = MutableStateFlow<AuthState>(AuthState.Resolving)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    private val _form = MutableStateFlow(SignInForm())
    val form: StateFlow<SignInForm> = _form.asStateFlow()

    init {
        resolveSession()
    }

    /**
     * Ask the server who we are.
     *
     * The stored cookie is only a hint. The server decides, so this always asks
     * rather than trusting local state — a session revoked from another device
     * is still present on disk here and must not be treated as valid.
     */
    fun resolveSession() {
        viewModelScope.launch {
            if (!store.hasSession) {
                _state.value = AuthState.SignedOut
                return@launch
            }
            when (val result = repository.currentUser()) {
                is ApiResult.Ok ->
                    _state.value = result.value?.let { AuthState.SignedIn(it) } ?: AuthState.SignedOut
                is ApiResult.Err -> _state.value = when (result.error) {
                    // Only an explicit rejection signs the user out. A network
                    // failure must not: losing signal would otherwise destroy
                    // the session and any unsent work with it.
                    is ApiError.Unauthenticated -> { store.clear(); AuthState.SignedOut }
                    else -> AuthState.SignedOut
                }
            }
        }
    }

    fun onEmailChange(value: String) {
        _form.value = _form.value.copy(email = value, error = null, lockedOut = false)
    }

    fun onPasswordChange(value: String) {
        _form.value = _form.value.copy(password = value, error = null)
    }

    fun onDisplayNameChange(value: String) {
        _form.value = _form.value.copy(displayName = value, error = null)
    }

    /**
     * Switch between signing in and registering.
     *
     * The password is cleared, not carried across. A password typed for an
     * account that exists is not the password being chosen for a new one, and
     * leaving it in the field invites submitting it as both.
     */
    fun toggleMode() {
        val current = _form.value
        _form.value = current.copy(
            mode = if (current.mode == AuthMode.SignIn) AuthMode.Register else AuthMode.SignIn,
            password = "",
            error = null,
            lockedOut = false,
        )
    }

    fun submit() {
        val current = _form.value
        if (!current.canSubmit) return
        _form.value = current.copy(submitting = true, error = null)

        viewModelScope.launch {
            val result = when (current.mode) {
                AuthMode.SignIn -> repository.signIn(current.email, current.password)
                AuthMode.Register ->
                    repository.register(current.email, current.password, current.displayName)
            }
            finish(result, current)
        }
    }

    // ── Passkeys ──────────────────────────────────────────────────────────

    /**
     * Step one: ask the server for a challenge.
     *
     * Split from [completePasskeySignIn] because the middle step belongs to the
     * platform, not to this class. Credential Manager needs an Activity to show
     * its sheet, and a ViewModel that held one would leak it across a rotation.
     * So the screen drives the prompt and hands the result back.
     *
     * The email is optional and only narrows the credential list — the server's
     * response is identical whether or not the address exists, so nothing here
     * may treat "no credential offered" as "no such account".
     */
    fun beginPasskeySignIn(onChallenge: (JsonElement) -> Unit) {
        val current = _form.value
        if (current.busy) return
        _form.value = current.copy(passkeyInFlight = true, error = null)

        viewModelScope.launch {
            when (val result = repository.passkeyChallenge(current.email)) {
                is ApiResult.Ok -> onChallenge(result.value)
                is ApiResult.Err ->
                    _form.value = _form.value.copy(passkeyInFlight = false, error = result.error.message)
            }
        }
    }

    /** Step three: hand the authenticator's response to the server. */
    fun completePasskeySignIn(assertion: JsonElement) {
        viewModelScope.launch {
            finish(repository.passkeyLogin(assertion), _form.value)
        }
    }

    /**
     * The user dismissed the system sheet.
     *
     * Cancelling a prompt is a decision, not a failure to report — so this
     * clears the in-flight flag and shows nothing, exactly as the web client
     * swallows `NotAllowedError`.
     */
    fun cancelPasskeySignIn() {
        _form.value = _form.value.copy(passkeyInFlight = false, error = null)
    }

    /** The platform refused or found nothing. That IS worth saying. */
    fun failPasskeySignIn(message: String) {
        _form.value = _form.value.copy(passkeyInFlight = false, error = message)
    }

    private fun finish(result: ApiResult<SessionUser>, from: SignInForm) {
        when (result) {
            is ApiResult.Ok -> {
                // The password is dropped from memory the moment it is no
                // longer needed. It is never stored, and never logged.
                _form.value = SignInForm(email = from.email)
                _state.value = AuthState.SignedIn(result.value)
            }
            is ApiResult.Err -> {
                val e = result.error
                _form.value = from.copy(
                    submitting = false,
                    passkeyInFlight = false,
                    password = "",
                    error = e.message,
                    lockedOut = e is ApiError.RateLimited,
                )
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            repository.signOut()
            _state.value = AuthState.SignedOut
        }
    }

    /** Called when any authenticated call reports the session is gone. */
    fun onSessionExpired() {
        store.clear()
        _state.value = AuthState.SignedOut
    }
}
