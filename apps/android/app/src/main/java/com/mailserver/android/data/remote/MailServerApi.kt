package com.mailserver.android.data.remote

import com.mailserver.android.data.model.ActionRequest
import com.mailserver.android.data.model.ActionResult
import com.mailserver.android.data.model.CreateDraftRequest
import com.mailserver.android.data.model.CreateDraftResponse
import com.mailserver.android.data.model.LoadDraftResponse
import com.mailserver.android.data.model.RecipientsResponse
import com.mailserver.android.data.model.SaveDraftRequest
import com.mailserver.android.data.model.SaveDraftResponse
import com.mailserver.android.data.model.SendDraftRequest
import com.mailserver.android.data.model.SendDraftResponse
import com.mailserver.android.data.model.UploadResponse
import com.mailserver.android.data.model.LabelsResponse
import com.mailserver.android.data.model.LoginRequest
import com.mailserver.android.data.model.LoginResponse
import com.mailserver.android.data.model.PasskeyChallengeRequest
import com.mailserver.android.data.model.PasskeyChallengeResponse
import com.mailserver.android.data.model.RegisterRequest
import com.mailserver.android.data.model.RegisterResponse
import com.mailserver.android.data.model.MailboxesResponse
import com.mailserver.android.data.model.PublicConfig
import com.mailserver.android.data.model.SessionEnvelope
import com.mailserver.android.data.model.ThreadDetail
import com.mailserver.android.data.model.ThreadPage
import kotlinx.serialization.json.JsonElement
import retrofit2.Response
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.Header
import retrofit2.http.PUT
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The Mail Server HTTP surface this client uses.
 *
 * Every path here exists in apps/web/app/api — nothing is invented, and nothing
 * is Android-only. When Android needs something the server does not expose, the
 * endpoint is added to the shared backend so the web client gets it too (§34,
 * §61 of the brief); it does not get a private route.
 *
 * Returns `Response<T>` rather than `T` so the error envelope and the status
 * are both available to [ApiClient.execute]. A bare `T` would turn every
 * non-2xx into an exception and lose the server's `code`.
 */
interface MailServerApi {

    // ── Authentication ────────────────────────────────────────────────────

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @POST("api/auth/logout")
    suspend fun logout(): Response<Unit>

    /**
     * Create an account.
     *
     * Returns 201 and sets the session cookie, so a successful registration is
     * already signed in — there is no second login round trip.
     *
     * A 409 means the address is taken, worded identically to a failed login so
     * the endpoint is not an account-enumeration oracle. The client must not
     * "helpfully" rephrase it into something more specific.
     */
    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequest): Response<RegisterResponse>

    /** Begin a passkey sign-in. Unauthenticated by necessity. */
    @POST("api/auth/passkey/challenge")
    suspend fun passkeyChallenge(@Body body: PasskeyChallengeRequest): Response<PasskeyChallengeResponse>

    /**
     * Complete a passkey sign-in.
     *
     * The body is the authenticator's response passed through verbatim as JSON.
     * On success the server creates a session exactly as a password sign-in
     * does — the passkey replaces the password and nothing downstream changes.
     */
    @POST("api/auth/passkey")
    suspend fun passkeyLogin(@Body body: JsonElement): Response<LoginResponse>

    /**
     * The cold-start probe.
     *
     * Returns 200 with `{"user": null}` when there is no session — NOT a 401.
     * Callers branch on the null, not the status.
     */
    @GET("api/auth/session")
    suspend fun session(): Response<SessionEnvelope>

    // ── Configuration ─────────────────────────────────────────────────────

    /** Limits the client must read rather than hardcode. */
    @GET("api/config")
    suspend fun config(): Response<PublicConfig>

    // ── Mail ──────────────────────────────────────────────────────────────

    /**
     * Keyset-paginated threads.
     *
     * [cursor] is opaque and comes only from a previous `nextCursor`. [limit] is
     * clamped server-side to `maxPageSize`, so the response may be shorter than
     * asked for; paging is driven by `nextCursor` alone.
     */
    @GET("api/mail")
    suspend fun threads(
        @Query("mailboxId") mailboxId: String? = null,
        @Query("labelId") labelId: String? = null,
        @Query("q") query: String? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int? = null,
    ): Response<ThreadPage>

    @GET("api/mail/{threadId}")
    suspend fun thread(@Path("threadId") threadId: String): Response<ThreadDetail>

    /**
     * Mailbox actions, including bulk.
     *
     * One request carries many ids — §16 forbids looping single requests, and
     * the server is built to take the batch.
     */
    @POST("api/mail/actions")
    suspend fun applyAction(@Body body: ActionRequest): Response<ActionResult>

    @GET("api/mailboxes")
    suspend fun mailboxes(): Response<MailboxesResponse>

    @GET("api/labels")
    suspend fun labels(): Response<LabelsResponse>

    // ── Compose and drafts ────────────────────────────────────────────────

    /**
     * Start a draft.
     *
     * With a reply mode the server builds it from the stored message —
     * recipients, subject, quoted body and the threading headers all come from
     * the row, never from here. That is not a convenience: a client-supplied
     * In-Reply-To is a client-supplied claim about what it is answering.
     */
    @POST("api/drafts")
    suspend fun createDraft(@Body body: CreateDraftRequest): Response<CreateDraftResponse>

    @GET("api/drafts/{id}")
    suspend fun loadDraft(@Path("id") id: String): Response<LoadDraftResponse>

    /**
     * Save. A 409 carries the server's copy so the client can compare rather
     * than guess — see [DraftConflict].
     */
    @PUT("api/drafts/{id}")
    suspend fun saveDraft(@Path("id") id: String, @Body body: SaveDraftRequest): Response<SaveDraftResponse>

    @DELETE("api/drafts/{id}")
    suspend fun deleteDraft(@Path("id") id: String): Response<Unit>

    /**
     * Send.
     *
     * The idempotency key makes a retried or double-submitted request return
     * the original result rather than sending twice. It is generated once per
     * send ATTEMPT and reused across retries of that attempt — regenerating it
     * on retry would defeat the entire mechanism.
     */
    @POST("api/drafts/{id}/send")
    suspend fun sendDraft(
        @Path("id") id: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: SendDraftRequest,
    ): Response<SendDraftResponse>

    /**
     * Upload one attachment.
     *
     * The filename travels in a header rather than the body because the body IS
     * the file — raw bytes, streamed. Multipart would mean buffering the whole
     * file to build the envelope, which is exactly what a 100MB attachment
     * cannot afford on a phone.
     */
    @POST("api/attachments/upload")
    suspend fun uploadAttachment(
        @Header("X-Filename") filename: String,
        @Body body: RequestBody,
    ): Response<UploadResponse>

    /** Addresses this account has corresponded with, for recipient completion. */
    @GET("api/recipients")
    suspend fun recipients(@Query("q") query: String): Response<RecipientsResponse>
}
