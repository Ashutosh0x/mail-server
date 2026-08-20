package com.mailserver.android.ui.compose

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mailserver.android.data.MailRepository
import com.mailserver.android.data.model.Draft
import com.mailserver.android.data.model.DraftAttachment
import com.mailserver.android.data.model.RecipientSuggestion
import com.mailserver.android.data.model.ReplyMode
import com.mailserver.android.data.model.SaveDraftRequest
import com.mailserver.android.data.model.SendDraftResponse
import com.mailserver.android.data.model.Sender
import com.mailserver.android.data.remote.ApiError
import com.mailserver.android.data.remote.ApiResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.InputStream
import java.util.UUID

/**
 * What the autosave indicator is allowed to say.
 *
 * [Saved] is only ever set from a server response. The rule §15 states — "do
 * not say Saved if the server rejected the update" — is enforced by this type
 * having no way to reach Saved except through a successful save, and by
 * [Offline] and [Failed] being distinct so a network loss is never rendered as
 * a rejection or vice versa.
 */
sealed interface SaveState {
    data object Idle : SaveState
    data object Saving : SaveState
    data class Saved(val at: String?) : SaveState
    data object Offline : SaveState
    data class Failed(val message: String) : SaveState

    /**
     * Another writer saved this draft first.
     *
     * Never resolved automatically. The server sends its copy with the 409, but
     * silently taking either side loses somebody's typing — so the user is
     * asked, and [ComposeViewModel.overwriteConflict] or
     * [ComposeViewModel.discardMine] is what resolves it.
     */
    data class Conflict(val message: String) : SaveState
}

/** An attachment mid-upload. The server has not seen it yet. */
data class PendingAttachment(
    val localId: String,
    val filename: String,
    val sizeBytes: Long?,
    val error: String? = null,
)

data class ComposeState(
    val draftId: String? = null,
    val to: String = "",
    val cc: String = "",
    val bcc: String = "",
    val subject: String = "",
    val body: String = "",
    /** Shown only once the user asks for them — most messages need neither. */
    val showCcBcc: Boolean = false,
    val attachments: List<DraftAttachment> = emptyList(),
    val uploading: List<PendingAttachment> = emptyList(),
    /** Addresses the server says this account may send as. */
    val senders: List<Sender> = emptyList(),
    val from: String? = null,
    val saveState: SaveState = SaveState.Idle,
    val loading: Boolean = true,
    val loadError: ApiError? = null,
    val sending: Boolean = false,
    val suggestions: List<RecipientSuggestion> = emptyList(),
    /** Which field the completions belong to, so they land in the right one. */
    val suggestionTarget: RecipientField? = null,
) {
    val canSend: Boolean
        get() = !sending &&
            draftId != null &&
            to.isNotBlank() &&
            uploading.isEmpty() &&
            saveState !is SaveState.Conflict

    /** True when there is anything a user would be sad to lose. */
    val hasContent: Boolean
        get() = to.isNotBlank() || cc.isNotBlank() || bcc.isNotBlank() ||
            subject.isNotBlank() || body.isNotBlank() || attachments.isNotEmpty()
}

enum class RecipientField { To, Cc, Bcc }

sealed interface ComposeEvent {
    /** Sent, and the server said what happened to it. */
    data class Sent(val message: String) : ComposeEvent
    data class Failed(val message: String) : ComposeEvent
    /** The composer should close. */
    data object Dismiss : ComposeEvent
}

/**
 * One message being written.
 *
 * The draft lives on the SERVER from the first moment: `POST /api/drafts`
 * happens when the composer opens, not when the user first types. That is what
 * makes an interrupted compose recoverable — a draft that only exists in this
 * ViewModel is lost when the process is killed, which on Android is a routine
 * event rather than a crash.
 *
 * Autosave is debounced, not per-keystroke, and carries the version last read
 * so a save that lost a race is reported rather than silently overwriting
 * whatever the other writer did.
 */
class ComposeViewModel(
    private val repository: MailRepository,
    private val onSessionExpired: () -> Unit,
) : ViewModel() {

    private val _state = MutableStateFlow(ComposeState())
    val state: StateFlow<ComposeState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<ComposeEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<ComposeEvent> = _events.asSharedFlow()

    private var saveJob: Job? = null
    private var suggestJob: Job? = null

    /** The version the server last confirmed. Sent with every save. */
    private var version: Int? = null

    /**
     * Held across retries of one send.
     *
     * Regenerating this on retry would defeat idempotency entirely: a request
     * that timed out but actually succeeded would send the message twice.
     */
    private var sendKey: String? = null

    // ── Opening ───────────────────────────────────────────────────────────

    /** A blank message. */
    fun startBlank() {
        viewModelScope.launch {
            when (val created = repository.createDraft()) {
                is ApiResult.Ok -> adoptNewDraft(created.value.draftId, created.value.senders)
                is ApiResult.Err -> failToOpen(created.error)
            }
        }
    }

    /**
     * A reply, reply-all or forward.
     *
     * The server builds the whole thing from the stored message, so this loads
     * what it produced rather than composing quoted text locally. A client that
     * builds its own quote and threading headers is a client asserting what a
     * message replies to.
     */
    fun startReply(mode: ReplyMode, sourceMessageId: String) {
        viewModelScope.launch {
            when (val created = repository.createReplyDraft(mode, sourceMessageId)) {
                is ApiResult.Ok -> {
                    adoptNewDraft(created.value.draftId, created.value.senders)
                    loadExisting(created.value.draftId)
                }
                is ApiResult.Err -> failToOpen(created.error)
            }
        }
    }

    /** Reopen a draft from the Drafts mailbox. */
    fun openDraft(draftId: String) {
        loadExisting(draftId)
    }

    private fun adoptNewDraft(draftId: String, senders: List<Sender>) {
        version = 0
        _state.value = _state.value.copy(
            draftId = draftId,
            senders = senders,
            from = senders.firstOrNull()?.email,
            loading = false,
            loadError = null,
        )
    }

    private fun loadExisting(draftId: String) {
        viewModelScope.launch {
            when (val result = repository.loadDraft(draftId)) {
                is ApiResult.Ok -> {
                    val draft = result.value.draft
                    version = draft.version
                    _state.value = _state.value.copy(
                        draftId = draft.id,
                        to = draft.to.joinToString(", ") { it.email },
                        cc = draft.cc.joinToString(", ") { it.email },
                        bcc = draft.bcc.joinToString(", ") { it.email },
                        showCcBcc = draft.cc.isNotEmpty() || draft.bcc.isNotEmpty(),
                        subject = draft.subject,
                        body = htmlToText(draft.bodyHtml),
                        attachments = draft.attachments,
                        senders = result.value.senders,
                        from = result.value.senders.firstOrNull()?.email,
                        loading = false,
                        loadError = null,
                        saveState = SaveState.Idle,
                    )
                }
                is ApiResult.Err -> failToOpen(result.error)
            }
        }
    }

    private fun failToOpen(error: ApiError) {
        if (error is ApiError.Unauthenticated) onSessionExpired()
        _state.value = _state.value.copy(loading = false, loadError = error)
    }

    // ── Editing ───────────────────────────────────────────────────────────

    fun onToChange(value: String) = edit(RecipientField.To) { it.copy(to = value) }
    fun onCcChange(value: String) = edit(RecipientField.Cc) { it.copy(cc = value) }
    fun onBccChange(value: String) = edit(RecipientField.Bcc) { it.copy(bcc = value) }
    fun onSubjectChange(value: String) = edit(null) { it.copy(subject = value) }
    fun onBodyChange(value: String) = edit(null) { it.copy(body = value) }

    fun toggleCcBcc() {
        _state.value = _state.value.copy(showCcBcc = !_state.value.showCcBcc)
    }

    fun selectFrom(email: String) {
        _state.value = _state.value.copy(from = email)
    }

    private fun edit(field: RecipientField?, change: (ComposeState) -> ComposeState) {
        _state.value = change(_state.value)
        scheduleSave()
        field?.let { suggestFor(it) }
    }

    /**
     * Save after the typing stops.
     *
     * §15 is explicit that autosave must not create a request per keystroke.
     * The pending save is cancelled on each edit, so a burst of typing produces
     * exactly one PUT once it settles.
     */
    private fun scheduleSave() {
        val current = _state.value
        if (current.draftId == null) return
        // A conflict is a decision the user has to make. Continuing to autosave
        // over it would resolve it by attrition, in favour of whoever typed last.
        if (current.saveState is SaveState.Conflict) return

        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(AUTOSAVE_DEBOUNCE_MS)
            save()
        }
    }

    private suspend fun save(force: Boolean = false) {
        val current = _state.value
        val id = current.draftId ?: return

        _state.value = current.copy(saveState = SaveState.Saving)

        val request = SaveDraftRequest(
            to = parseAddresses(current.to),
            cc = parseAddresses(current.cc),
            bcc = parseAddresses(current.bcc),
            subject = current.subject,
            bodyHtml = textToHtml(current.body),
            attachmentIds = current.attachments.map { it.id },
            // Omitting the version force-saves. Only ever done because the user
            // chose to overwrite, never as a way around a conflict.
            version = if (force) null else version,
        )

        when (val result = repository.saveDraft(id, request)) {
            is ApiResult.Ok -> {
                version = result.value.version
                _state.value = _state.value.copy(saveState = SaveState.Saved(result.value.savedAt))
            }
            is ApiResult.Err -> {
                val error = result.error
                if (error is ApiError.Unauthenticated) onSessionExpired()
                _state.value = _state.value.copy(
                    saveState = when (error) {
                        // Distinct states, because they mean opposite things:
                        // offline is "not yet", conflict is "someone else did",
                        // failed is "the server said no".
                        is ApiError.Network -> SaveState.Offline
                        is ApiError.Conflict -> SaveState.Conflict(
                            "This draft changed somewhere else. Keep your version, or discard it and reload?"
                        )
                        else -> SaveState.Failed(error.message)
                    }
                )
            }
        }
    }

    /** Retry a save the user was told had failed. */
    fun retrySave() {
        viewModelScope.launch { save() }
    }

    /** Conflict resolution: keep what is on screen and overwrite the server. */
    fun overwriteConflict() {
        viewModelScope.launch { save(force = true) }
    }

    /** Conflict resolution: throw away local edits and take the server's copy. */
    fun discardMine() {
        _state.value.draftId?.let { loadExisting(it) }
    }

    // ── Recipients ────────────────────────────────────────────────────────

    private fun suggestFor(field: RecipientField) {
        val raw = when (field) {
            RecipientField.To -> _state.value.to
            RecipientField.Cc -> _state.value.cc
            RecipientField.Bcc -> _state.value.bcc
        }
        // Only the fragment after the last separator is being typed.
        val fragment = raw.substringAfterLast(',').trim()

        suggestJob?.cancel()
        if (fragment.length < 2) {
            _state.value = _state.value.copy(suggestions = emptyList(), suggestionTarget = null)
            return
        }

        suggestJob = viewModelScope.launch {
            delay(SUGGEST_DEBOUNCE_MS)
            when (val result = repository.recipients(fragment)) {
                is ApiResult.Ok -> _state.value =
                    _state.value.copy(suggestions = result.value, suggestionTarget = field)
                // A failed completion is not worth telling anyone about; the
                // user can still type the address in full.
                is ApiResult.Err -> _state.value =
                    _state.value.copy(suggestions = emptyList(), suggestionTarget = null)
            }
        }
    }

    fun acceptSuggestion(email: String) {
        val field = _state.value.suggestionTarget ?: return
        val current = when (field) {
            RecipientField.To -> _state.value.to
            RecipientField.Cc -> _state.value.cc
            RecipientField.Bcc -> _state.value.bcc
        }
        // Replace the fragment being typed, keeping anything already entered.
        val completed = buildString {
            val prefix = current.substringBeforeLast(',', "")
            if (prefix.isNotBlank()) append(prefix.trim()).append(", ")
            append(email).append(", ")
        }

        _state.value = when (field) {
            RecipientField.To -> _state.value.copy(to = completed)
            RecipientField.Cc -> _state.value.copy(cc = completed)
            RecipientField.Bcc -> _state.value.copy(bcc = completed)
        }.copy(suggestions = emptyList(), suggestionTarget = null)

        scheduleSave()
    }

    // ── Attachments ───────────────────────────────────────────────────────

    /**
     * Upload one file.
     *
     * [openStream] is a factory rather than a stream so the repository can open
     * it on the IO dispatcher at the moment it writes to the socket — and so a
     * retry can open a fresh one, which a consumed stream could not provide.
     */
    fun attach(filename: String, contentType: String?, sizeBytes: Long?, openStream: () -> InputStream) {
        val localId = UUID.randomUUID().toString()
        _state.value = _state.value.copy(
            uploading = _state.value.uploading + PendingAttachment(localId, filename, sizeBytes)
        )

        viewModelScope.launch {
            when (val result = repository.uploadAttachment(filename, contentType, openStream)) {
                is ApiResult.Ok -> {
                    val a = result.value.attachment
                    _state.value = _state.value.copy(
                        uploading = _state.value.uploading.filterNot { it.localId == localId },
                        attachments = _state.value.attachments + DraftAttachment(
                            id = a.id,
                            filename = a.filename,
                            size = a.size,
                            contentType = a.contentType,
                        ),
                    )
                    // The draft now references it, so the server must be told.
                    save()
                }
                is ApiResult.Err -> {
                    if (result.error is ApiError.Unauthenticated) onSessionExpired()
                    // The row stays, carrying its error, rather than vanishing.
                    // A file that silently fails to attach is one the user
                    // discovers is missing after they have sent the message.
                    _state.value = _state.value.copy(
                        uploading = _state.value.uploading.map {
                            if (it.localId == localId) it.copy(error = result.error.message) else it
                        }
                    )
                }
            }
        }
    }

    fun dismissFailedUpload(localId: String) {
        _state.value = _state.value.copy(
            uploading = _state.value.uploading.filterNot { it.localId == localId }
        )
    }

    fun removeAttachment(attachmentId: String) {
        _state.value = _state.value.copy(
            attachments = _state.value.attachments.filterNot { it.id == attachmentId }
        )
        viewModelScope.launch { save() }
    }

    // ── Sending ───────────────────────────────────────────────────────────

    /**
     * Send.
     *
     * The draft is saved first and the save must succeed. Sending a draft whose
     * last edit never reached the server would send a different message from
     * the one on screen — which is the worst possible failure for a mail client
     * and completely invisible to the sender.
     */
    fun send() {
        val current = _state.value
        if (!current.canSend) return
        val id = current.draftId ?: return

        _state.value = current.copy(sending = true)

        viewModelScope.launch {
            saveJob?.cancel()
            save()

            if (_state.value.saveState !is SaveState.Saved) {
                _state.value = _state.value.copy(sending = false)
                _events.tryEmit(
                    ComposeEvent.Failed("Your latest changes could not be saved, so nothing was sent.")
                )
                return@launch
            }

            val key = sendKey ?: UUID.randomUUID().toString().also { sendKey = it }

            when (val result = repository.sendDraft(id, key, _state.value.from)) {
                is ApiResult.Ok -> {
                    sendKey = null
                    _events.tryEmit(ComposeEvent.Sent(describe(result.value)))
                    _events.tryEmit(ComposeEvent.Dismiss)
                }
                is ApiResult.Err -> {
                    if (result.error is ApiError.Unauthenticated) onSessionExpired()
                    // The key is deliberately KEPT so a retry of this same
                    // attempt cannot send twice.
                    _state.value = _state.value.copy(sending = false)
                    _events.tryEmit(ComposeEvent.Failed(result.error.message))
                }
            }
        }
    }

    /**
     * What actually happened to the message.
     *
     * A server with no SMTP transport configured still accepts the send and
     * queues it. Reporting that as "Sent" is a lie the user only uncovers when
     * the message never arrives, so the queued case says so.
     */
    private fun describe(result: SendDraftResponse): String = when {
        !result.transportConfigured ->
            "Queued. This server has no mail transport configured, so it has not been delivered."
        result.delivery?.status?.equals("sent", ignoreCase = true) == true -> "Message sent"
        result.delivery?.detail?.isNotBlank() == true -> "Queued: ${result.delivery.detail}"
        else -> "Queued for delivery"
    }

    // ── Closing ───────────────────────────────────────────────────────────

    /**
     * Leave the composer, keeping the draft.
     *
     * A final save is forced if anything is still pending, because closing is
     * exactly when an un-fired debounce would lose the last sentence someone
     * typed.
     */
    fun closeKeepingDraft() {
        viewModelScope.launch {
            saveJob?.cancel()
            if (_state.value.draftId != null && _state.value.saveState !is SaveState.Saved) save()
            _events.tryEmit(ComposeEvent.Dismiss)
        }
    }

    /** Throw the draft away. Permanent — drafts do not go to Trash. */
    fun discardDraft() {
        val id = _state.value.draftId
        viewModelScope.launch {
            saveJob?.cancel()
            id?.let { repository.deleteDraft(it) }
            _events.tryEmit(ComposeEvent.Dismiss)
        }
    }

    private companion object {
        const val AUTOSAVE_DEBOUNCE_MS = 900L
        const val SUGGEST_DEBOUNCE_MS = 200L
    }
}

/**
 * Split a recipient field into addresses.
 *
 * Commas and semicolons both separate, because both are what people paste.
 * Validation is NOT done here — the server validates addresses and its answer
 * is the one that counts; a second opinion on this side would reject something
 * the server would have accepted.
 */
internal fun parseAddresses(raw: String): List<Sender> =
    raw.split(',', ';')
        .map(String::trim)
        .filter(String::isNotEmpty)
        .map { Sender(email = it) }

/**
 * The composer edits plain text; the draft stores HTML.
 *
 * Deliberately minimal, and deliberately not a rich-text editor. Escaping is
 * the part that matters: an unescaped `<` in a body is a tag the recipient's
 * client may act on, and the server sanitises what it stores but the draft
 * should not be storing markup the user did not write in the first place.
 */
internal fun textToHtml(text: String): String =
    text.split("\n").joinToString("") { line ->
        val escaped = line
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        if (escaped.isBlank()) "<p><br></p>" else "<p>$escaped</p>"
    }

/**
 * The reverse, for reopening a draft.
 *
 * Lossy for anything richer than paragraphs and breaks, which is why the
 * composer is honest about being plain text. A draft written in the web
 * client's editor and reopened here keeps its words and loses its formatting —
 * stated in docs/android/compose.md rather than hidden.
 */
internal fun htmlToText(html: String): String =
    html
        .replace(Regex("(?i)<br\\s*/?>"), "\n")
        .replace(Regex("(?i)</p\\s*>"), "\n")
        .replace(Regex("<[^>]+>"), "")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        // Last, or it would un-escape entities that were themselves escaped.
        .replace("&amp;", "&")
        .trim()
