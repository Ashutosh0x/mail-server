package com.mailserver.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Mirrors packages/types/src/mail.ts.
 *
 * Field names match the TypeScript exactly and are NOT renamed to Kotlin
 * conventions, because the wire format is the contract. If a field is renamed
 * in the shared package, this file must fail to decode rather than silently
 * produce a null — which is why nothing here has a default that papers over an
 * absent field.
 *
 * Unknown fields are ignored by the Json configuration in ApiClient, so the
 * server can add a field without breaking older installs. Removing one is a
 * breaking change on both clients equally.
 */

@Serializable
data class EmailAddress(
    /** Display name, if the sender supplied one. */
    val name: String? = null,
    val email: String,
)

/**
 * JMAP mailbox roles (RFC 8621 §2). Null for user-created folders.
 *
 * The UI keys system folders off [role], never off [name]: a server may present
 * the inbox as "Posteingang", and matching the display name would silently fail
 * for every non-English deployment. That rule is inherited from the web client
 * and holds here.
 */
@Serializable
data class Mailbox(
    val id: String,
    val name: String,
    val parentId: String? = null,
    val role: String? = null,
    val sortOrder: Int,
    val totalEmails: Int,
    val unreadEmails: Int,
    val totalThreads: Int,
    val unreadThreads: Int,
)

@Serializable
data class Attachment(
    /** JMAP blobId — the handle used to download the part. */
    val blobId: String,
    val partId: String? = null,
    val name: String? = null,
    val type: String,
    val size: Long,
    /** True for images referenced by `cid:` from the HTML body. */
    val isInline: Boolean = false,
    val cid: String? = null,
)

/**
 * Per-mechanism outcome from the receiving MTA.
 *
 * `none` and `fail` stay distinct here for the same reason the server keeps
 * them distinct: "published no policy" and "published a policy and violated it"
 * are opposite signals, and collapsing them is how a UI teaches people to
 * ignore the warning.
 */
@Serializable
data class AuthenticationSummary(
    val spf: String,
    val dkim: String,
    val dmarc: String,
    val arc: String? = null,
    /** TLS version of the final inbound hop. Null means plaintext. */
    val tls: String? = null,
    val displayNameSpoof: Boolean = false,
    val idnHomograph: Boolean = false,
)

@Serializable
data class EmailHeader(
    val id: String,
    val blobId: String,
    val threadId: String,
    val mailboxIds: List<String> = emptyList(),
    val keywords: List<String> = emptyList(),
    val from: List<EmailAddress> = emptyList(),
    val to: List<EmailAddress> = emptyList(),
    val cc: List<EmailAddress> = emptyList(),
    val bcc: List<EmailAddress> = emptyList(),
    val replyTo: List<EmailAddress> = emptyList(),
    val subject: String,
    /** Server-generated snippet: plain text, already truncated. */
    val preview: String,
    val receivedAt: String,
    val sentAt: String? = null,
    val size: Long,
    val hasAttachment: Boolean = false,
    val attachments: List<Attachment> = emptyList(),
    val authentication: AuthenticationSummary? = null,
    /**
     * Derived on the SERVER from the whole authentication summary. Never
     * recomputed here — three clients deriving "is this phishing" three ways is
     * three chances to disagree about one message.
     */
    val verdict: String? = null,
    val snoozedUntil: String? = null,
) {
    /** RFC-registered keyword for "read". Absence means unread. */
    val isUnread: Boolean get() = !keywords.contains("\$seen")
    val isStarred: Boolean get() = keywords.contains("\$flagged")

    /**
     * What a list row shows as the correspondent. Falls back to the address
     * when no display name was supplied, and never to a placeholder — an
     * invented "Unknown sender" would be the client asserting something the
     * message did not say.
     */
    val displayFrom: String
        get() = from.firstOrNull()?.let { it.name?.takeIf(String::isNotBlank) ?: it.email } ?: ""
}

@Serializable
data class EmailBody(
    val id: String,
    /**
     * Sanitised by the server. Still never rendered outside a restricted
     * WebView — see ui/message/BodyRenderer.kt for the containment rules.
     */
    val htmlBody: String? = null,
    val textBody: String? = null,
    /** Remote images found and withheld, so the UI can offer to load them. */
    val blockedRemoteImages: Int = 0,
    /** 1x1 beacons and known tracker hosts stripped outright. */
    val strippedTrackers: Int = 0,
)

@Serializable
data class Thread(
    val id: String,
    val emailIds: List<String> = emptyList(),
    /** Denormalised for the list: the newest message's facts. */
    val latest: EmailHeader,
    val messageCount: Int,
    val unreadCount: Int,
    val hasAttachment: Boolean = false,
    val participants: List<EmailAddress> = emptyList(),
)

@Serializable
data class Label(
    val id: String,
    val name: String,
    /** One of the twelve LABEL_COLORS in the shared package. */
    val color: String,
)

/**
 * The page shape returned by GET /api/mail — see ThreadPage in
 * apps/web/lib/server/mail.ts.
 *
 * [nextCursor] null is the end-of-list signal. An empty [items] is NOT: the
 * server may return a short page and still have more, because `limit` is
 * clamped server-side.
 */
@Serializable
data class ThreadPage(
    val items: List<Thread> = emptyList(),
    val nextCursor: String? = null,
    val total: Int? = null,
)

@Serializable
data class ThreadDetail(
    val thread: Thread,
    val emails: List<EmailHeader> = emptyList(),
)

/** The signed-in user, from GET /api/auth/session. */
@Serializable
data class SessionUser(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val role: String? = null,
    val quotaBytes: Long? = null,
    val usedBytes: Long? = null,
)

@Serializable
data class SessionEnvelope(val user: SessionUser? = null)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginResponse(val user: SessionUser)

/**
 * POST /api/auth/register.
 *
 * [displayName] is required by the server and must not contain line breaks —
 * it goes into a mail header, and a header that can be split is a header
 * injection. The server rejects it, and the client does not try to sanitise it
 * into something acceptable.
 */
@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val displayName: String,
)

/** 201 from register. Narrower than [SessionUser]: no quota figures yet. */
@Serializable
data class RegisteredUser(
    val id: String,
    val email: String,
    val displayName: String? = null,
)

@Serializable
data class RegisterResponse(val user: RegisteredUser)

/**
 * POST /api/auth/passkey/challenge.
 *
 * [email] is optional and only narrows the credential list. The response is
 * deliberately identical whether or not the address exists — an empty
 * allowCredentials would confirm the account — so nothing here may treat a
 * challenge that finds no credential as "no such user".
 */
@Serializable
data class PasskeyChallengeRequest(val email: String? = null)

/**
 * The server's WebAuthn options, kept as raw JSON.
 *
 * NOT parsed into Kotlin types. Android's Credential Manager takes the options
 * as a JSON string and hands back a JSON string, and the WebAuthn structures
 * are large, versioned and full of base64url fields whose exact encoding
 * matters. Re-encoding them through a hand-written model is a chance to change
 * a byte that must not change; passing the server's own JSON through keeps the
 * client out of a negotiation it is not party to.
 */
@Serializable
data class PasskeyChallengeResponse(val options: JsonElement)

@Serializable
data class MailboxesResponse(val mailboxes: List<Mailbox> = emptyList())

@Serializable
data class LabelsResponse(val labels: List<Label> = emptyList())

/**
 * The closed action vocabulary from MessageAction in apps/web/lib/server/mail.ts.
 *
 * An enum rather than a string so an action the server does not implement
 * cannot be sent at all. [wire] is the exact token the API expects.
 */
enum class MessageAction(val wire: String) {
    Read("read"),
    Unread("unread"),
    Star("star"),
    Unstar("unstar"),
    Archive("archive"),
    Trash("trash"),
    Restore("restore"),
    Spam("spam"),
    /** Permanent. Irreversible, so no Undo is offered for it. */
    Delete("delete"),
}

@Serializable
data class ActionRequest(
    @SerialName("messageIds") val messageIds: List<String>,
    @SerialName("action") val action: String,
)

/**
 * What POST /api/mail/actions actually returns.
 *
 * [changed] is NOT decoration. The server puts `user_id` in the WHERE clause of
 * every action, so an id belonging to another account matches nothing and comes
 * back as a lower `changed` than `requested` — never as an error. A client that
 * decodes this as Unit throws away the one signal that distinguishes "applied
 * to all fifty" from "applied to forty-eight, because two had already moved".
 *
 * [failures] is populated only by `purge`, which deletes blobs before rows and
 * reports a partial failure as one rather than rounding it up to success.
 */
@Serializable
data class ActionResult(
    val changed: Int,
    val requested: Int,
    val freedBytes: Long? = null,
    val failures: List<String> = emptyList(),
) {
    /** True when the server did less than was asked of it. */
    val partial: Boolean get() = changed < requested
}

/**
 * GET /api/config — publicConfig() in apps/web/lib/server/config.ts.
 *
 * Limits are READ FROM HERE and never hardcoded on the device. `uploadChunkBytes`
 * in particular is the server telling the client how to chunk; choosing a chunk
 * size locally would be a client deciding a server concern.
 */
@Serializable
data class PublicConfig(
    val maxAttachmentBytes: Long,
    val maxMessageBytes: Long? = null,
    val maxOutboundMessageBytes: Long? = null,
    val maxUserStorageBytes: Long? = null,
    val uploadChunkBytes: Long? = null,
    val maxRecipients: Int? = null,
    val maxPageSize: Int,
    val defaultPageSize: Int,
    /** False when no SMTP host is configured: Send is disabled WITH A REASON. */
    val outboundConfigured: Boolean = false,
)
