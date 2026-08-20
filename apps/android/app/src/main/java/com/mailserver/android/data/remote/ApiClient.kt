package com.mailserver.android.data.remote

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.mailserver.android.BuildConfig
import com.mailserver.android.data.auth.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/**
 * Builds the HTTP stack and turns every response into an [ApiResult].
 *
 * Three things here are deliberate.
 *
 * NO BODY LOGGING, EVER. The logging interceptor runs at BASIC even in debug
 * builds, and not at all in release. BODY level would put message contents,
 * recipient addresses and the session cookie into logcat, which §42 forbids
 * and which no amount of "it's only debug" makes safe on a shared device.
 *
 * RETRIES ARE NOT AUTOMATIC FOR WRITES. OkHttp's `retryOnConnectionFailure`
 * only re-attempts connection-level failures, which is safe. Application-level
 * retry of a POST is not, because "archive these 200 threads" applied twice is
 * not the same as applied once, and the server exposes no idempotency key yet.
 * §33 says not to retry destructive operations blindly; this obeys it by not
 * retrying them at all.
 *
 * TIMEOUTS ARE FINITE. A mail list that hangs forever is indistinguishable from
 * one that is loading, and the user is left staring at a spinner.
 */
object ApiClient {

    /**
     * Unknown fields are ignored so the server can add one without breaking
     * installed clients. Absent fields are NOT defaulted silently — the models
     * declare their own defaults only where the contract genuinely allows the
     * field to be missing.
     */
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = false
    }

    fun create(baseUrl: String, store: SessionStore): MailServerApi {
        val cookieJar = SessionCookieJar(store)

        val builder = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)

        if (BuildConfig.DEBUG) {
            builder.addInterceptor(
                HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
            )
        }

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(builder.build())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(MailServerApi::class.java)
    }

    /**
     * Run one call and classify the outcome.
     *
     * Nothing throws past this boundary except cancellation, which must
     * propagate or a cancelled coroutine would be reported to the user as a
     * network error.
     */
    suspend fun <T> execute(block: suspend () -> Response<T>): ApiResult<T> =
        withContext(Dispatchers.IO) {
            try {
                val response = block()
                if (response.isSuccessful) {
                    val body = response.body()
                    @Suppress("UNCHECKED_CAST")
                    when {
                        body != null -> ApiResult.Ok(body)
                        // A 204 or an empty 200 is a success for Unit-returning
                        // calls, and a decode failure for anything else.
                        response.code() == 204 || response.code() == 200 ->
                            ApiResult.Ok(Unit as T)
                        else -> ApiResult.Err(ApiError.Malformed("The server returned an empty response."))
                    }
                } else {
                    ApiResult.Err(classify(response))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: UnknownHostException) {
                ApiResult.Err(ApiError.Network("Cannot reach the server. Check your connection."))
            } catch (e: SocketTimeoutException) {
                ApiResult.Err(ApiError.Network("The server took too long to respond."))
            } catch (e: IOException) {
                ApiResult.Err(ApiError.Network("Cannot reach the server. Check your connection."))
            } catch (e: Exception) {
                // Serialization failures land here: the server said something
                // this build cannot read, which is a client problem, not a
                // server outage. Kept distinct so the message can say so.
                ApiResult.Err(ApiError.Malformed("This version of the app could not read the server's response."))
            }
        }

    private fun <T> classify(response: Response<T>): ApiError {
        val raw = runCatching { response.errorBody()?.string() }.getOrNull()
        val detail = raw?.let {
            runCatching { json.decodeFromString<ApiErrorBody>(it).error }.getOrNull()
        }

        // The server's own message when it sent one; a generic sentence when it
        // did not. Never a status code shown to the user, and never a stack
        // trace — guard() in http.ts makes sure one never arrives.
        val message = detail?.message ?: defaultMessage(response.code())

        return when (response.code()) {
            401 -> ApiError.Unauthenticated(message)
            403 -> ApiError.Forbidden(message)
            404 -> ApiError.NotFound(message)
            409 -> ApiError.Conflict(message, raw)
            429 -> ApiError.RateLimited(
                message,
                response.headers()["Retry-After"]?.toLongOrNull(),
            )
            in 400..499 -> ApiError.BadRequest(message, detail?.code ?: "bad_request")
            else -> ApiError.Server(message, response.code())
        }
    }

    private fun defaultMessage(status: Int): String = when (status) {
        401 -> "Sign in to continue."
        403 -> "You do not have access to that."
        404 -> "That is no longer available."
        409 -> "This changed somewhere else."
        429 -> "Too many attempts. Try again shortly."
        in 500..599 -> "Something went wrong on the server. Please try again."
        else -> "That request could not be completed."
    }
}
