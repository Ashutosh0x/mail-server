package com.mailserver.android.ui.compose

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns

/**
 * What the system document picker actually gave us.
 *
 * A content Uri carries no filename or size of its own — those live in the
 * provider's metadata and have to be queried. Guessing a name from the Uri's
 * last path segment produces things like "msf:1000000042", which is what the
 * recipient would then see as the attachment name.
 */
data class PickedFile(
    val uri: Uri,
    val filename: String,
    val contentType: String?,
    /** Null when the provider does not report one. Never guessed. */
    val sizeBytes: Long?,
)

/**
 * Resolve a picked Uri to its real name, type and size.
 *
 * Returns null when the provider will not say what the file is called. That is
 * a genuine failure rather than an occasion for a placeholder: sending an
 * attachment named "file" when the user picked "contract-final.pdf" is a
 * silent corruption of what they meant to send.
 */
fun resolvePickedFile(context: Context, uri: Uri): PickedFile? {
    val resolver = context.contentResolver

    val (name, size) = resolver.query(uri, null, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null to null

        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)

        val resolvedName = if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
            cursor.getString(nameIndex)
        } else null

        // A provider may legitimately not know the size — a stream still being
        // written, for instance. Null travels through as null.
        val resolvedSize = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
            cursor.getLong(sizeIndex)
        } else null

        resolvedName to resolvedSize
    } ?: (null to null)

    if (name.isNullOrBlank()) return null

    return PickedFile(
        uri = uri,
        filename = name,
        contentType = resolver.getType(uri),
        sizeBytes = size,
    )
}
