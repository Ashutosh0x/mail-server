package com.mailserver.android.ui.common

import com.mailserver.android.data.remote.ApiError

/**
 * The states §30 requires every screen to be able to show.
 *
 * A sealed hierarchy rather than a bag of booleans, because `isLoading &&
 * isEmpty && error != null` is representable with booleans and means nothing.
 * Here the impossible combinations cannot be written down.
 */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    /** Loaded and non-empty. */
    data class Content<T>(val value: T, val refreshing: Boolean = false) : UiState<T>
    /** Loaded, and the server genuinely has nothing. Not an error. */
    data object Empty : UiState<Nothing>
    data class Failed(val error: ApiError) : UiState<Nothing>
}
