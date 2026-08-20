package com.mailserver.android.ui.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mailserver.android.data.MailRepository
import com.mailserver.android.data.model.ActionResult
import com.mailserver.android.data.model.Mailbox
import com.mailserver.android.data.model.MessageAction
import com.mailserver.android.data.model.Thread
import com.mailserver.android.data.remote.ApiError
import com.mailserver.android.data.remote.ApiResult
import com.mailserver.android.ui.common.UiState
import com.mailserver.android.ui.mail.DeleteOperation
import com.mailserver.android.ui.mail.deletePolicyFor
import com.mailserver.android.ui.mail.inverseOf
import com.mailserver.android.ui.mail.pastTenseOf
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class InboxState(
    val threads: UiState<List<Thread>> = UiState.Loading,
    val mailboxes: List<Mailbox> = emptyList(),
    val selectedMailboxId: String? = null,
    /** Null once the server says there is no next page. */
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    /** Non-null when appending a page failed; the list already shown stays. */
    val appendError: ApiError? = null,
    val selection: Set<String> = emptySet(),
    /** The raw search box contents. Sent to the server verbatim as `q`. */
    val query: String = "",
    /** True while the search field is open, so the top bar swaps. */
    val searching: Boolean = false,
    /** True while a bulk action is in flight, so the toolbar cannot double-fire. */
    val actionInFlight: Boolean = false,
    /** Set when an irreversible deletion is waiting to be confirmed. */
    val confirmingDelete: Boolean = false,
) {
    val inSelectionMode: Boolean get() = selection.isNotEmpty()

    /**
     * Whether the list currently shows search results.
     *
     * Drives the empty state: "Your inbox is empty" is FALSE when the mailbox
     * has mail and the query simply matched none of it.
     */
    val hasQuery: Boolean get() = query.isNotBlank()
    val hasMore: Boolean get() = nextCursor != null

    val activeMailbox: Mailbox? get() = mailboxes.firstOrNull { it.id == selectedMailboxId }

    /**
     * The role every policy decision keys off.
     *
     * Never the mailbox NAME: a server may present the inbox as "Posteingang",
     * and matching a display name would silently give a non-English deployment
     * the default policy — which is the one where Delete is reversible. That
     * failure would be invisible until someone lost mail.
     */
    val activeRole: String? get() = activeMailbox?.role
}

/**
 * Something to tell the user once, rather than a state to render forever.
 *
 * Separate from [InboxState] because a snackbar is an event: replaying it on
 * every recomposition would re-announce "Archived" each time the device rotated.
 */
sealed interface InboxEvent {
    /**
     * An action completed. [undo] is non-null only where the server can
     * genuinely reverse it — never for a permanent deletion, because offering
     * Undo there would be a promise the backend cannot keep.
     */
    data class Completed(
        val message: String,
        val undo: (() -> Unit)?,
    ) : InboxEvent

    data class Failed(val message: String) : InboxEvent
}

/**
 * The thread list.
 *
 * Paging is keyset and server-driven: the only cursor ever sent is one the
 * server produced, and the end of the list is `nextCursor == null` — never an
 * empty page, because `limit` is clamped server-side and a short page can still
 * have more behind it.
 *
 * NOTHING IS APPLIED LOCALLY. Every action goes to the server and the list is
 * re-read from what came back. There is no optimistic mutation of the visible
 * rows, which means the app can never show a state the server rejected — the
 * failure mode §55 rules out for stars and §14 rules out for everything else.
 *
 * There is no local mailbox. Nothing here caches to disk yet; Room arrives in a
 * later phase as a cache, with the server still authoritative.
 */
class InboxViewModel(
    private val repository: MailRepository,
    private val onSessionExpired: () -> Unit,
) : ViewModel() {

    private val _state = MutableStateFlow(InboxState())
    val state: StateFlow<InboxState> = _state.asStateFlow()

    /** The pending debounced search, cancelled when another keystroke lands. */
    private var searchJob: Job? = null

    private val _events = MutableSharedFlow<InboxEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<InboxEvent> = _events.asSharedFlow()

    init {
        loadMailboxes()
        refresh()
    }

    /**
     * Mailboxes, and the counts the drawer shows.
     *
     * Re-read after every action, because an archive or a trash changes
     * `unreadThreads` on two mailboxes at once and a stale count in the drawer
     * is the most visible kind of lie this app can tell.
     */
    private fun loadMailboxes() {
        viewModelScope.launch {
            when (val result = repository.mailboxes()) {
                is ApiResult.Ok -> {
                    val boxes = result.value
                    _state.value = _state.value.copy(
                        mailboxes = boxes,
                        // Land in the account's real Inbox on first load rather
                        // than in "all mail". Falls back to whatever the server
                        // sorted first if this account has no inbox role.
                        selectedMailboxId = _state.value.selectedMailboxId
                            ?: boxes.firstOrNull { it.role == "inbox" }?.id,
                    )
                    if (_state.value.threads is UiState.Loading) refresh()
                }
                is ApiResult.Err -> reportIfExpired(result.error)
            }
        }
    }

    fun selectMailbox(mailboxId: String?) {
        if (mailboxId == _state.value.selectedMailboxId) return
        _state.value = _state.value.copy(
            selectedMailboxId = mailboxId,
            threads = UiState.Loading,
            nextCursor = null,
            // A selection is a set of ids in the mailbox being left. Carrying it
            // across would point the next action at messages the user can no
            // longer see.
            selection = emptySet(),
            // Same for the query: "is:unread from:ada" scoped to the Inbox is
            // not a search the user asked for in Trash.
            query = "",
            searching = false,
        )
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val current = _state.value
            // A refresh over existing content keeps the content visible and
            // marks it refreshing, rather than flashing a spinner over a list
            // the user is reading.
            if (current.threads is UiState.Content) {
                _state.value = current.copy(threads = current.threads.copy(refreshing = true))
            }

            when (val result = repository.threads(
                mailboxId = current.selectedMailboxId,
                query = current.query,
            )) {
                is ApiResult.Ok -> {
                    val page = result.value
                    _state.value = _state.value.copy(
                        threads = if (page.items.isEmpty()) UiState.Empty
                                  else UiState.Content(page.items),
                        nextCursor = page.nextCursor,
                        appendError = null,
                    )
                }
                is ApiResult.Err -> {
                    reportIfExpired(result.error)
                    // Keep whatever is on screen if there is something; only an
                    // empty screen becomes a full-screen error.
                    val shown = _state.value.threads
                    _state.value = _state.value.copy(
                        threads = if (shown is UiState.Content) shown.copy(refreshing = false)
                                  else UiState.Failed(result.error),
                        appendError = if (shown is UiState.Content) result.error else null,
                    )
                }
            }
        }
    }

    /** Append the next page. No-op when a page is in flight or the list ended. */
    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor ?: return
        if (current.loadingMore) return

        _state.value = current.copy(loadingMore = true, appendError = null)
        viewModelScope.launch {
            when (val result = repository.threads(
                mailboxId = current.selectedMailboxId,
                query = current.query,
                cursor = cursor,
            )) {
                is ApiResult.Ok -> {
                    val existing = (_state.value.threads as? UiState.Content)?.value.orEmpty()
                    val page = result.value
                    _state.value = _state.value.copy(
                        threads = UiState.Content(existing + page.items),
                        nextCursor = page.nextCursor,
                        loadingMore = false,
                    )
                }
                is ApiResult.Err -> {
                    reportIfExpired(result.error)
                    _state.value = _state.value.copy(loadingMore = false, appendError = result.error)
                }
            }
        }
    }

    // ── Search ────────────────────────────────────────────────────────────

    /**
     * The search box changed.
     *
     * Debounced rather than fired per keystroke: the grammar is server-side, so
     * every character would otherwise be a full query against the mailbox. The
     * previous pending search is cancelled, so only the last one in a burst of
     * typing reaches the server.
     *
     * The grammar itself — `from:`, `has:attachment`, `is:unread`, `newer:7d`
     * and the rest — is NOT parsed here. It is parsed by the same shared module
     * the web's filter chips use, which is exactly why a chip and the rows
     * returned cannot disagree. A second parser on the client would be a second
     * opinion about what the user asked for.
     */
    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value)

        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            _state.value = _state.value.copy(threads = UiState.Loading, nextCursor = null)
            refresh()
        }
    }

    fun openSearch() {
        _state.value = _state.value.copy(searching = true, selection = emptySet())
    }

    /** Close the search field and go back to the whole mailbox. */
    fun closeSearch() {
        searchJob?.cancel()
        val had = _state.value.hasQuery
        _state.value = _state.value.copy(searching = false, query = "")
        // Only re-read when a query was actually applied. Closing an empty
        // search box changed nothing, and refetching would be a round trip to
        // arrive at the list already on screen.
        if (had) {
            _state.value = _state.value.copy(threads = UiState.Loading, nextCursor = null)
            refresh()
        }
    }

    // ── Selection ─────────────────────────────────────────────────────────

    fun toggleSelection(threadId: String) {
        val selection = _state.value.selection
        _state.value = _state.value.copy(
            selection = if (threadId in selection) selection - threadId else selection + threadId
        )
    }

    /**
     * Select every thread currently loaded — the page, not the mailbox.
     *
     * The distinction is the whole point. "Select all in Inbox" is a different
     * promise, one that reaches rows the user has never seen, and conflating
     * the two is how a bulk delete takes more than was intended. The UI says
     * which of the two this is.
     */
    fun selectAllLoaded() {
        val loaded = (_state.value.threads as? UiState.Content)?.value.orEmpty()
        _state.value = _state.value.copy(selection = loaded.map { it.id }.toSet())
    }

    fun clearSelection() {
        _state.value = _state.value.copy(selection = emptySet())
    }

    // ── Actions ───────────────────────────────────────────────────────────

    /**
     * Apply one action to the whole selection in a single request.
     *
     * Bulk is the shape, not an optimisation: fifty archives are one round trip
     * and one server transaction, never fifty of each.
     */
    fun applyToSelection(action: MessageAction) {
        applyTo(_state.value.selection.toList(), action, clearSelection = true)
    }

    /** One thread, from a swipe or a row menu. Same path as the toolbar. */
    fun applyToThread(threadId: String, action: MessageAction) {
        applyTo(listOf(threadId), action, clearSelection = false)
    }

    /**
     * Toggle the star on a conversation's newest message.
     *
     * Scoped to the message the row is showing, not the whole thread: the row
     * displays `latest`'s star, so starring the entire thread would set a state
     * the row never claimed.
     */
    fun toggleStar(thread: Thread) {
        val action = if (thread.latest.isStarred) MessageAction.Unstar else MessageAction.Star
        viewModelScope.launch {
            when (val result = repository.applyAction(listOf(thread.latest.id), action)) {
                is ApiResult.Ok -> {
                    // No snackbar: the star's own change of state is the
                    // feedback, and a toast for every star would bury the ones
                    // that matter. The refresh is what makes the icon true.
                    refresh()
                }
                is ApiResult.Err -> {
                    reportIfExpired(result.error)
                    // The icon never moved, so there is nothing to roll back —
                    // it is still showing the server's last known answer.
                    _events.tryEmit(InboxEvent.Failed(result.error.message))
                }
            }
        }
    }

    /**
     * The mailbox-appropriate Delete.
     *
     * Reversible mailboxes go straight through with an Undo offer. Trash, Spam
     * and Drafts raise the confirmation first, because purge destroys the
     * message and its attachment bytes and nothing brings those back.
     */
    fun requestDelete() {
        val policy = deletePolicyFor(_state.value.activeRole, _state.value.selection.size)
        if (policy.confirm) {
            _state.value = _state.value.copy(confirmingDelete = true)
        } else {
            applyTo(_state.value.selection.toList(), MessageAction.Trash, clearSelection = true)
        }
    }

    fun cancelDelete() {
        _state.value = _state.value.copy(confirmingDelete = false)
    }

    /** Only reachable from the confirmation dialog. */
    fun confirmDelete() {
        val current = _state.value
        val policy = deletePolicyFor(current.activeRole, current.selection.size)
        _state.value = current.copy(confirmingDelete = false)

        if (policy.operation == DeleteOperation.Trash) {
            applyTo(current.selection.toList(), MessageAction.Trash, clearSelection = true)
            return
        }

        val messageIds = messageIdsFor(current.selection)
        if (messageIds.isEmpty()) return

        _state.value = _state.value.copy(actionInFlight = true)
        viewModelScope.launch {
            val result = repository.purge(messageIds)
            _state.value = _state.value.copy(actionInFlight = false, selection = emptySet())

            when (result) {
                is ApiResult.Ok -> {
                    refreshAll()
                    val outcome = result.value
                    _events.tryEmit(
                        InboxEvent.Completed(
                            message = summarise(outcome, "Deleted permanently"),
                            // Never an undo. Nothing restores a purged message.
                            undo = null,
                        )
                    )
                }
                is ApiResult.Err -> {
                    reportIfExpired(result.error)
                    // The rows are still on screen and still exist. The list is
                    // re-read so the user sees the truth rather than a gap.
                    refresh()
                    _events.tryEmit(InboxEvent.Failed(result.error.message))
                }
            }
        }
    }

    /**
     * The single path every reversible action takes.
     *
     * Toolbar, swipe and row menu all arrive here, so there is one place where
     * authorization, reconciliation, the snackbar and the Undo offer are
     * decided. Three call sites each doing their own version is how a swipe
     * ends up meaning something the buttons do not.
     */
    private fun applyTo(threadIds: List<String>, action: MessageAction, clearSelection: Boolean) {
        if (threadIds.isEmpty() || _state.value.actionInFlight) return

        val messageIds = messageIdsFor(threadIds.toSet())
        if (messageIds.isEmpty()) return

        _state.value = _state.value.copy(actionInFlight = true)

        viewModelScope.launch {
            val result = repository.applyAction(messageIds, action)
            _state.value = _state.value.copy(
                actionInFlight = false,
                selection = if (clearSelection) emptySet() else _state.value.selection,
            )

            when (result) {
                is ApiResult.Ok -> {
                    refreshAll()
                    val outcome = result.value
                    val inverse = inverseOf(action)

                    _events.tryEmit(
                        InboxEvent.Completed(
                            message = summarise(
                                outcome,
                                pastTenseOf(action).replaceFirstChar(Char::uppercaseChar),
                            ),
                            // Undo re-sends the SAME message ids with the
                            // inverse action. It is a real server call, not a
                            // local rewind — and it is offered only where an
                            // inverse genuinely exists.
                            undo = inverse?.let {
                                {
                                    viewModelScope.launch {
                                        when (val back = repository.applyAction(messageIds, it)) {
                                            is ApiResult.Ok -> refreshAll()
                                            is ApiResult.Err -> {
                                                reportIfExpired(back.error)
                                                _events.tryEmit(InboxEvent.Failed(back.error.message))
                                            }
                                        }
                                    }
                                    Unit
                                }
                            },
                        )
                    )
                }
                is ApiResult.Err -> {
                    reportIfExpired(result.error)
                    // The rows never moved, because nothing was applied locally.
                    // Re-reading puts the list back in step with the server for
                    // the case where the failure was a conflict.
                    refresh()
                    _events.tryEmit(InboxEvent.Failed(result.error.message))
                }
            }
        }
    }

    /**
     * Expand selected threads to the message ids the server acts on.
     *
     * A thread id is not a message id. Actions apply to messages, and the ids
     * used are the ones the server itself supplied in `emailIds` — the client
     * never constructs one.
     */
    private fun messageIdsFor(threadIds: Set<String>): List<String> {
        val threads = (_state.value.threads as? UiState.Content)?.value.orEmpty()
        return threads.filter { it.id in threadIds }.flatMap { it.emailIds }
    }

    /** Both the list and the drawer counts, which an action changes together. */
    private fun refreshAll() {
        refresh()
        loadMailboxes()
    }

    /**
     * What the snackbar says.
     *
     * A partial result is reported as a partial result. The server returns
     * `changed` below `requested` when an id did not match — because it had
     * already moved, or was never this account's — and saying "Archived" when
     * eight of ten were archived is the app claiming an outcome it was
     * explicitly told did not happen.
     */
    private fun summarise(outcome: ActionResult, verb: String): String = when {
        outcome.failures.isNotEmpty() ->
            "$verb ${outcome.changed} of ${outcome.requested}. ${outcome.failures.size} could not be removed."
        outcome.partial ->
            "$verb ${outcome.changed} of ${outcome.requested}. The rest had already changed."
        else -> verb
    }

    fun dismissAppendError() {
        _state.value = _state.value.copy(appendError = null)
    }

    private fun reportIfExpired(error: ApiError) {
        if (error is ApiError.Unauthenticated) onSessionExpired()
    }

    private companion object {
        /**
         * Long enough to cover typing, short enough not to feel laggy.
         * Matches the web client's debounce so both feel the same.
         */
        const val SEARCH_DEBOUNCE_MS = 250L
    }
}
