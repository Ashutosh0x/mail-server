package com.mailserver.android.data.model

import kotlinx.serialization.Serializable

/**
 * The compose and draft contracts, mirroring apps/web/lib/api.ts.
 *
 * Two things here are load-bearing and easy to get wrong.
 *
 * VERSION IS OPTIMISTIC CONCURRENCY, NOT A COUNTER. Every save sends the
 * version last read; the server rejects with 409 and its own copy attached when
 * that no longer matches, which is exactly what happens when the same draft is
 * open in a browser tab. Dropping the field turns every save into a
 * last-writer-wins overwrite of work done somewhere else.
 *
 * FROM COMES FROM THE SERVER. `senders` is the list of addresses this account is
 * actually authorised to send as. A From the client can choose is a From anyone
 * can forge, which is the whole reason SPF, DKIM and DMARC exist downstream.
 */

@Serializable
data class Sender(
    val name: String? = null,
    val email: String,
)

/** POST /api/drafts — a new draft, or a reply/forward built from a message. */
@Serializable
data class CreateDraftRequest(
    /** "reply", "replyAll" or "forward". Null for a blank compose. */
    val mode: String? = null,
    /** The message being answered. Required with [mode]. */
    val sourceId: String? = null,
)

@Serializable
data class CreateDraftResponse(
    val draftId: String,
    val senders: List<Sender> = emptyList(),
)

@Serializable
data class DraftAttachment(
    val id: String,
    val filename: String,
    val size: Long,
    val contentType: String,
)

@Serializable
data class Draft(
    val id: String,
    val to: List<Sender> = emptyList(),
    val cc: List<Sender> = emptyList(),
    val bcc: List<Sender> = emptyList(),
    val subject: String = "",
    /**
     * The body as HTML.
     *
     * The Android composer edits plain text and converts on the way in and out
     * — see ComposeViewModel. A rich-text editor is a real piece of work and
     * pretending to have one by round-tripping tags through a plain field would
     * silently destroy formatting a web user had applied.
     */
    val bodyHtml: String = "",
    val attachments: List<DraftAttachment> = emptyList(),
    /** The value to send back with the next save. */
    val version: Int,
    val updatedAt: String? = null,
)

@Serializable
data class LoadDraftResponse(
    val draft: Draft,
    val senders: List<Sender> = emptyList(),
)

/**
 * PUT /api/drafts/{id}.
 *
 * [version] is the version last read. Omitting it force-saves, skipping the
 * conflict check — which this client never does implicitly. A force-save is
 * only ever the result of the user choosing to overwrite.
 */
@Serializable
data class SaveDraftRequest(
    val to: List<Sender> = emptyList(),
    val cc: List<Sender> = emptyList(),
    val bcc: List<Sender> = emptyList(),
    val subject: String = "",
    val bodyHtml: String = "",
    val attachmentIds: List<String> = emptyList(),
    val version: Int? = null,
)

@Serializable
data class SaveDraftResponse(
    val version: Int,
    val savedAt: String? = null,
)

/** The 409 body from a save that lost a race. */
@Serializable
data class DraftConflict(
    val conflict: Boolean = true,
    val draft: Draft? = null,
)

@Serializable
data class SendDraftRequest(
    /** One of the server's `senders`. Null lets the server pick the default. */
    val from: String? = null,
)

/**
 * The result of a send.
 *
 * [delivery] and [transportConfigured] are the honest part. A server with no
 * SMTP host configured still accepts the send and queues it, and reporting that
 * as "Sent" would be a lie the user only discovers when nothing arrives. The UI
 * reads these two fields and says what actually happened.
 */
@Serializable
data class SendDraftResponse(
    val messageId: String,
    val queueId: String,
    val status: String,
    val rfcMessageId: String? = null,
    val delivery: DeliveryOutcome? = null,
    val transportConfigured: Boolean = false,
)

@Serializable
data class DeliveryOutcome(
    val status: String,
    val detail: String? = null,
)

/** POST /api/attachments/upload — one file, named by the X-Filename header. */
@Serializable
data class UploadResponse(val attachment: UploadedAttachment)

@Serializable
data class UploadedAttachment(
    val id: String,
    val filename: String,
    val size: Long,
    val contentType: String,
    /**
     * True when the bytes do not match the declared type.
     *
     * Surfaced rather than silently corrected: a ".pdf" that sniffs as
     * something else is worth a person seeing.
     */
    val typeMismatch: Boolean = false,
)

/** GET /api/recipients?q= — addresses this account has corresponded with. */
@Serializable
data class RecipientSuggestion(
    val name: String? = null,
    val email: String,
    val count: Int = 0,
    val lastUsedAt: String? = null,
)

@Serializable
data class RecipientsResponse(val recipients: List<RecipientSuggestion> = emptyList())
