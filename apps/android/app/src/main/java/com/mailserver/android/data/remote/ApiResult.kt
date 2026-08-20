package com.mailserver.android.data.remote

import kotlinx.serialization.Serializable

/**
 * The server's one error envelope, from apps/web/lib/server/http.ts:
 *
 *   { "error": { "code": …, "message": …, "requestId": … } }
 *
 * Uniform on every endpoint. The comment in http.ts explains why that matters:
 * a client that has to guess the shape per endpoint ends up with a catch that
 * shows "Something went wrong" for everything. This client therefore branches
 * on [ApiError.code], not on the HTTP status alone.
 */
@Serializable
data class ApiErrorBody(val error: ApiErrorDetail)

@Serializable
data class ApiErrorDetail(
    val code: String,
    /** Written for a person by the server. Safe to display verbatim. */
    val message: String,
    /** Attach to a bug report; never show prominently. */
    val requestId: String? = null,
)

/**
 * Every failure the UI has to be able to render differently.
 *
 * This is a closed set on purpose. §30 of the brief requires an explicit state
 * for each, and an open `Exception` would let a new failure mode reach the UI
 * as an unhandled generic message.
 */
sealed interface ApiError {
    val message: String

    /** No session. The caller must re-authenticate. */
    data class Unauthenticated(override val message: String) : ApiError

    /** Authenticated, but not allowed. Re-authenticating will not help. */
    data class Forbidden(override val message: String) : ApiError

    data class NotFound(override val message: String) : ApiError

    /**
     * Optimistic-concurrency failure. [serverCopy] is the raw body, which for
     * drafts carries the server's current version — see §6 of
     * docs/android/api-integration.md. Never resolved automatically.
     */
    data class Conflict(override val message: String, val serverCopy: String?) : ApiError

    /** [retryAfterSeconds] is null when the server did not say. */
    data class RateLimited(override val message: String, val retryAfterSeconds: Long?) : ApiError

    data class BadRequest(override val message: String, val code: String) : ApiError

    /** 5xx. Retryable, but with backoff and a ceiling. */
    data class Server(override val message: String, val status: Int) : ApiError

    /** Never reached the server: no route, DNS, TLS, timeout. */
    data class Network(override val message: String) : ApiError

    /**
     * The server answered with something this build cannot decode. Kept
     * separate from [Server] because it means the client is out of date, not
     * that the server is broken.
     */
    data class Malformed(override val message: String) : ApiError
}

/**
 * Success or a typed failure. No exceptions cross the repository boundary, so a
 * ViewModel cannot forget to handle one.
 */
sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(val error: ApiError) : ApiResult<Nothing>
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Ok -> ApiResult.Ok(transform(value))
    is ApiResult.Err -> this
}

fun <T> ApiResult<T>.getOrNull(): T? = (this as? ApiResult.Ok)?.value
