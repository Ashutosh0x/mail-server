package com.mailserver.android.data

import com.mailserver.android.data.auth.SessionStore
import com.mailserver.android.data.model.ActionRequest
import com.mailserver.android.data.model.ActionResult
import com.mailserver.android.data.model.Label
import com.mailserver.android.data.model.LoginRequest
import com.mailserver.android.data.model.Mailbox
import com.mailserver.android.data.model.MessageAction
import com.mailserver.android.data.model.PasskeyChallengeRequest
import com.mailserver.android.data.model.CreateDraftRequest
import com.mailserver.android.data.model.CreateDraftResponse
import com.mailserver.android.data.model.LoadDraftResponse
import com.mailserver.android.data.model.PublicConfig
import com.mailserver.android.data.model.RecipientSuggestion
import com.mailserver.android.data.model.ReplyMode
import com.mailserver.android.data.model.SaveDraftRequest
import com.mailserver.android.data.model.SaveDraftResponse
import com.mailserver.android.data.model.SendDraftRequest
import com.mailserver.android.data.model.SendDraftResponse
import com.mailserver.android.data.model.UploadResponse
import com.mailserver.android.data.model.RegisterRequest
import com.mailserver.android.data.model.SessionUser
import com.mailserver.android.data.model.ThreadDetail
import com.mailserver.android.data.model.ThreadPage
import com.mailserver.android.data.remote.ApiClient
import com.mailserver.android.data.remote.ApiError
import com.mailserver.android.data.remote.ApiResult
import com.mailserver.android.data.remote.MailServerApi
import com.mailserver.android.data.remote.map
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.InputStream
import java.net.URLEncoder

/**
 * The only thing that talks to the server.
 *
 * The server is authoritative for every value this returns. Nothing here
 * invents a count, a mailbox, a message or a storage figure, and nothing
 * substitutes a placeholder when a call fails — a failure is returned as a
 * failure so the UI can say so. An empty mailbox renders the server's real
 * empty state, which is the point of §5.
 */
class MailRepository(
    private val api: MailServerApi,
    private val store: SessionStore,
) {

    private companion object {
        /**
         * The one wire token that is not a [MessageAction].
         *
         * Held here rather than added to the enum so that a caller cannot reach
         * permanent deletion by iterating actions — it has to be asked for by
         * name, through [purge].
         */
        const val PURGE = "purge"
    }

    // ── Session ───────────────────────────────────────────────────────────

    /**
     * Resolve the current session at cold start.
     *
     * A `null` user is a legitimate 200, not an error — see §3 of the
     * integration doc. Returning `Ok(null)` rather than an error keeps that
     * distinction visible to the caller.
     */
    suspend fun currentUser(): ApiResult<SessionUser?> =
        ApiClient.execute { api.session() }.map { it.user }

    suspend fun signIn(email: String, password: String): ApiResult<SessionUser> {
        val result = ApiClient.execute { api.login(LoginRequest(email.trim().lowercase(), password)) }
        // The cookie is captured by SessionCookieJar during the call itself;
        // this only records who it belongs to, for the signed-out screen.
        if (result is ApiResult.Ok) store.lastKnownEmail = result.value.user.email
        return result.map { it.user }
    }

    /**
     * Create an account, which signs it in.
     *
     * The server returns 201 *and* sets the session cookie, so there is no
     * second login call — and deliberately no re-send of the password to a
     * login endpoint, which would put it on the wire twice for no reason.
     *
     * The 201 body is narrower than a session user (no quota figures), so the
     * session is re-read rather than synthesised from what registration
     * returned. Guessing the missing fields would put invented numbers on the
     * account screen from the very first second.
     */
    suspend fun register(email: String, password: String, displayName: String): ApiResult<SessionUser> {
        val normalised = email.trim().lowercase()
        val created = ApiClient.execute {
            api.register(RegisterRequest(normalised, password, displayName.trim()))
        }
        if (created is ApiResult.Err) return created

        store.lastKnownEmail = normalised
        return when (val session = currentUser()) {
            is ApiResult.Ok -> session.value
                ?.let { ApiResult.Ok(it) }
                // The cookie was set and then did not come back. Reporting this
                // rather than pretending the account is unusable is the point:
                // the account WAS created, and telling the user it failed would
                // send them to register again into a 409.
                ?: ApiResult.Err(
                    ApiError.Server("Your account was created, but the session did not start. Sign in.", 500)
                )
            is ApiResult.Err -> session
        }
    }

    /**
     * Begin a passkey sign-in, returning the server's WebAuthn options.
     *
     * The options are handed on as raw JSON. See [PasskeyChallengeResponse] for
     * why they are never re-encoded through a Kotlin model.
     */
    suspend fun passkeyChallenge(email: String?): ApiResult<JsonElement> =
        ApiClient.execute {
            api.passkeyChallenge(PasskeyChallengeRequest(email?.trim()?.lowercase()?.takeIf(String::isNotBlank)))
        }.map { it.options }

    /** Complete a passkey sign-in with the authenticator's response. */
    suspend fun passkeyLogin(assertion: JsonElement): ApiResult<SessionUser> {
        val result = ApiClient.execute { api.passkeyLogin(assertion) }
        if (result is ApiResult.Ok) store.lastKnownEmail = result.value.user.email
        return result.map { it.user }
    }

    /**
     * Sign out.
     *
     * The local session is cleared even when the server call fails. A user who
     * asked to sign out on a train with no signal must not stay signed in on
     * the device; the server-side session is revoked on the next successful
     * call or expires on its own.
     */
    suspend fun signOut(): ApiResult<Unit> {
        val result = ApiClient.execute { api.logout() }
        store.clear()
        return result
    }

    // ── Configuration ─────────────────────────────────────────────────────

    suspend fun config(): ApiResult<PublicConfig> = ApiClient.execute { api.config() }

    // ── Mail ──────────────────────────────────────────────────────────────

    /**
     * One page of threads.
     *
     * [cursor] must be null for the first page and otherwise a `nextCursor` the
     * server produced. It is opaque — base64url of `receivedAt|id` compared as
     * a tuple — and constructing one here would break paging silently.
     */
    suspend fun threads(
        mailboxId: String? = null,
        labelId: String? = null,
        query: String? = null,
        cursor: String? = null,
        limit: Int? = null,
    ): ApiResult<ThreadPage> = ApiClient.execute {
        api.threads(mailboxId, labelId, query?.takeIf(String::isNotBlank), cursor, limit)
    }

    suspend fun thread(threadId: String): ApiResult<ThreadDetail> =
        ApiClient.execute { api.thread(threadId) }

    /**
     * Apply one action to many messages in a single request.
     *
     * Bulk is the default shape, not an optimisation: §16 forbids looping
     * hundreds of independent calls, and the server takes the batch.
     *
     * The [ActionResult] is returned rather than swallowed. `changed` below
     * `requested` is how the server reports that some ids did not match — an
     * id that has already moved, or one that was never the caller's — and it
     * arrives as a 200, not an error. Discarding it would leave the app unable
     * to tell a full success from a partial one.
     */
    suspend fun applyAction(messageIds: List<String>, action: MessageAction): ApiResult<ActionResult> {
        if (messageIds.isEmpty()) return ApiResult.Ok(ActionResult(changed = 0, requested = 0))
        return ApiClient.execute {
            api.applyAction(ActionRequest(messageIds, action.wire))
        }
    }

    /**
     * Permanently delete messages and their attachment bytes.
     *
     * Separate from [applyAction] because it is a different KIND of operation,
     * exactly as it is on the server: everything in [MessageAction] moves a row
     * or flips a flag and is reversible, while this destroys the record and the
     * file. The server routes it through storage-cleanup — blobs before rows,
     * partial failure reported honestly — and making it the tenth case of an
     * action enum would hide that at every call site.
     *
     * Nothing calls this without a confirmation. See `deletePolicyFor`.
     */
    suspend fun purge(messageIds: List<String>): ApiResult<ActionResult> {
        if (messageIds.isEmpty()) return ApiResult.Ok(ActionResult(changed = 0, requested = 0))
        return ApiClient.execute {
            api.applyAction(ActionRequest(messageIds, PURGE))
        }
    }

    // ── Compose and drafts ────────────────────────────────────────────────

    /** A blank draft. Returns its id and the addresses this account may send as. */
    suspend fun createDraft(): ApiResult<CreateDraftResponse> =
        ApiClient.execute { api.createDraft(CreateDraftRequest()) }

    /**
     * A reply, reply-all or forward.
     *
     * Only the mode and the source id are sent. Everything else — recipients,
     * subject, the quoted body, In-Reply-To and References — is derived by the
     * server from the stored message, because a client that supplies those is a
     * client asserting what a message is answering.
     */
    suspend fun createReplyDraft(mode: ReplyMode, sourceId: String): ApiResult<CreateDraftResponse> =
        ApiClient.execute { api.createDraft(CreateDraftRequest(mode.wire, sourceId)) }

    suspend fun loadDraft(id: String): ApiResult<LoadDraftResponse> =
        ApiClient.execute { api.loadDraft(id) }

    suspend fun saveDraft(id: String, body: SaveDraftRequest): ApiResult<SaveDraftResponse> =
        ApiClient.execute { api.saveDraft(id, body) }

    suspend fun deleteDraft(id: String): ApiResult<Unit> =
        ApiClient.execute { api.deleteDraft(id) }

    /**
     * Send a draft.
     *
     * [idempotencyKey] must be generated once per send ATTEMPT and reused if
     * that attempt is retried. A fresh key on retry would let a timed-out
     * request that actually succeeded be sent a second time.
     */
    suspend fun sendDraft(
        id: String,
        idempotencyKey: String,
        from: String?,
    ): ApiResult<SendDraftResponse> =
        ApiClient.execute { api.sendDraft(id, idempotencyKey, SendDraftRequest(from)) }

    /**
     * Upload one attachment, streaming from the content resolver.
     *
     * The [RequestBody] reads the stream straight into the socket rather than
     * loading the file into a ByteArray first. On a phone that distinction is
     * the difference between attaching a 100MB video and an OutOfMemoryError —
     * and the server's own limit is 100MB, so files that size are expected.
     */
    suspend fun uploadAttachment(
        filename: String,
        contentType: String?,
        openStream: () -> InputStream,
    ): ApiResult<UploadResponse> {
        val media = contentType?.toMediaTypeOrNull()

        val body = object : RequestBody() {
            override fun contentType() = media
            // Unknown length: the file is streamed with chunked encoding rather
            // than read once to measure it and again to send it.
            override fun contentLength(): Long = -1L
            override fun writeTo(sink: BufferedSink) {
                openStream().use { input -> sink.writeAll(input.source()) }
            }
        }

        return ApiClient.execute {
            // The name is percent-encoded because it travels in a header, and a
            // header value cannot carry a newline or a non-ASCII byte. A
            // filename is user-controlled, so this is header injection defence,
            // not tidiness.
            api.uploadAttachment(URLEncoder.encode(filename, "UTF-8"), body)
        }
    }

    /** Recipient completions. Blank queries are not sent. */
    suspend fun recipients(query: String): ApiResult<List<RecipientSuggestion>> {
        if (query.isBlank()) return ApiResult.Ok(emptyList())
        return ApiClient.execute { api.recipients(query.trim()) }.map { it.recipients }
    }

    suspend fun mailboxes(): ApiResult<List<Mailbox>> =
        ApiClient.execute { api.mailboxes() }.map { it.mailboxes }

    suspend fun labels(): ApiResult<List<Label>> =
        ApiClient.execute { api.labels() }.map { it.labels }
}
