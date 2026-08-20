package com.mailserver.android.ui.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Report
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mailserver.android.data.model.MessageAction
import com.mailserver.android.data.model.Thread
import com.mailserver.android.data.remote.ApiError
import com.mailserver.android.ui.common.UiState
import com.mailserver.android.ui.haptics.Haptic
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.haptics.ThresholdLatch
import com.mailserver.android.ui.mail.SwipeableRow
import com.mailserver.android.ui.mail.actionsFor
import com.mailserver.android.ui.mail.deletePolicyFor
import com.mailserver.android.ui.mail.emptyStateFor
import com.mailserver.android.ui.mail.leadingSwipeFor
import com.mailserver.android.ui.mail.trailingSwipeFor
import com.mailserver.android.ui.theme.MailTheme

/**
 * The thread list.
 *
 * Every state §30 demands is representable and rendered: loading, content,
 * empty, and each failure class with its own sentence. An empty mailbox shows
 * the server's real empty state — there is no seeded content anywhere in this
 * screen, and nothing is displayed that the server did not send.
 *
 * The toolbar is built from the mailbox's policy rather than from a fixed list
 * of buttons. "Archive" does not appear in Archive, "Not spam" appears only in
 * Spam, and Delete says what it will actually do. An action offered where it is
 * meaningless is a button that appears to fail.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    state: InboxState,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenThread: (Thread) -> Unit,
    onToggleSelect: (String) -> Unit,
    onToggleStar: (Thread) -> Unit,
    onSelectAll: () -> Unit,
    onClearSelection: () -> Unit,
    onBulkAction: (MessageAction) -> Unit,
    onThreadAction: (String, MessageAction) -> Unit,
    onRequestDelete: () -> Unit,
    onConfirmDelete: () -> Unit,
    onCancelDelete: () -> Unit,
    onOpenDrawer: () -> Unit,
    onCompose: () -> Unit,
    onQueryChange: (String) -> Unit,
    onOpenSearch: () -> Unit,
    onCloseSearch: () -> Unit,
    snackbarHost: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    val colors = MailTheme.colors
    val haptics = LocalHaptics.current
    val listState = rememberLazyListState()
    val role = state.activeRole

    // Prefetch one screen ahead so the next page is already arriving when the
    // user reaches the bottom, rather than stalling at the last row.
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val total = listState.layoutInfo.totalItemsCount
            total > 0 && last >= total - 5
        }
    }
    LaunchedEffect(shouldLoadMore, state.hasMore, state.loadingMore) {
        if (shouldLoadMore && state.hasMore && !state.loadingMore) onLoadMore()
    }

    // An append failure keeps the list on screen and reports itself here — a
    // page that failed to load must not replace mail the user is reading.
    LaunchedEffect(state.appendError) {
        state.appendError?.let { snackbarHost.showSnackbar(it.message) }
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHost) },
        containerColor = colors.canvas,
        topBar = {
            if (state.searching) {
                SearchBar(
                    query = state.query,
                    onQueryChange = onQueryChange,
                    onClose = onCloseSearch,
                )
            } else if (state.inSelectionMode) {
                SelectionBar(
                    count = state.selection.size,
                    role = role,
                    onClear = onClearSelection,
                    onSelectAll = onSelectAll,
                    onAction = onBulkAction,
                    onDelete = onRequestDelete,
                )
            } else {
                TopAppBar(
                    title = {
                        // The mailbox's own name, as the server gave it. Not a
                        // hardcoded "Inbox", which would be wrong the moment
                        // the user opens anything else — or on any deployment
                        // that does not present its mailboxes in English.
                        Text(
                            text = state.activeMailbox?.name ?: "Mail",
                            style = MaterialTheme.typography.titleLarge,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = {
                            haptics.perform(Haptic.Drawer)
                            onOpenDrawer()
                        }) {
                            Icon(Icons.Filled.Menu, contentDescription = "Open navigation menu")
                        }
                    },
                    actions = {
                        // Search is one tap from the mailbox, never behind the
                        // drawer — §57 is explicit that opening a menu to reach
                        // search is too far.
                        IconButton(onClick = {
                            haptics.perform(Haptic.Press)
                            onOpenSearch()
                        }) {
                            Icon(Icons.Filled.Search, contentDescription = "Search mail")
                        }
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = colors.canvas,
                        titleContentColor = colors.ink,
                    ),
                )
            }
        },
        floatingActionButton = {
            // Hidden during selection: the FAB would sit over the rows being
            // acted on, and composing is not what the user is doing.
            if (!state.inSelectionMode) {
                FloatingActionButton(onClick = {
                    haptics.perform(Haptic.Press)
                    onCompose()
                }) {
                    Icon(Icons.Filled.Edit, contentDescription = "Compose")
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (val threads = state.threads) {
                is UiState.Loading -> CenteredProgress()

                is UiState.Empty -> {
                    // A mailbox with mail that a query did not match is NOT an
                    // empty mailbox, and must not claim to be.
                    val copy = emptyStateFor(role, searching = state.hasQuery)
                    EmptyState(title = copy.title, body = copy.body)
                }

                is UiState.Failed -> ErrorState(error = threads.error, onRetry = onRefresh)

                is UiState.Content -> ThreadList(
                    threads = threads.value,
                    refreshing = threads.refreshing,
                    state = state,
                    role = role,
                    listState = listState,
                    onRefresh = onRefresh,
                    onOpenThread = onOpenThread,
                    onToggleSelect = onToggleSelect,
                    onToggleStar = onToggleStar,
                    onThreadAction = onThreadAction,
                )
            }
        }
    }

    if (state.confirmingDelete) {
        val policy = deletePolicyFor(role, state.selection.size)
        AlertDialog(
            onDismissRequest = onCancelDelete,
            title = { Text(policy.confirmTitle) },
            text = { Text(policy.confirmBody) },
            confirmButton = {
                TextButton(onClick = {
                    haptics.perform(Haptic.ConfirmDestructive)
                    onConfirmDelete()
                }) {
                    Text(policy.label, color = colors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = onCancelDelete) { Text("Cancel") }
            },
            containerColor = colors.surfaceRaised,
        )
    }
}

/**
 * The list, with pull-to-refresh.
 *
 * The refresh haptic fires when the pull crosses the point where releasing
 * would actually refresh — once, latched — so the gesture has a felt boundary
 * rather than a continuous buzz down the whole drag.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThreadList(
    threads: List<Thread>,
    refreshing: Boolean,
    state: InboxState,
    role: String?,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onRefresh: () -> Unit,
    onOpenThread: (Thread) -> Unit,
    onToggleSelect: (String) -> Unit,
    onToggleStar: (Thread) -> Unit,
    onThreadAction: (String, MessageAction) -> Unit,
) {
    val colors = MailTheme.colors
    val haptics = LocalHaptics.current
    val pullState = rememberPullToRefreshState()
    val latch = remember(haptics) { ThresholdLatch(haptics) }

    LaunchedEffect(pullState.distanceFraction) {
        latch.update(pullState.distanceFraction >= 1f)
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        state = pullState,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            items(threads, key = { it.id }) { thread ->
                // Swipe is disabled while selecting. During a multi-select the
                // horizontal gesture belongs to the selection, and acting on a
                // single row mid-selection is almost never what was meant.
                if (state.inSelectionMode) {
                    ThreadRow(
                        thread = thread,
                        selected = thread.id in state.selection,
                        selectionMode = true,
                        onOpen = { onOpenThread(thread) },
                        onToggleSelect = { onToggleSelect(thread.id) },
                        onToggleStar = { onToggleStar(thread) },
                    )
                } else {
                    SwipeableRow(
                        leading = leadingSwipeFor(role),
                        trailing = trailingSwipeFor(role, thread.unreadCount > 0),
                        onAction = { spec -> onThreadAction(thread.id, spec.action) },
                    ) {
                        ThreadRow(
                            thread = thread,
                            selected = false,
                            selectionMode = false,
                            onOpen = { onOpenThread(thread) },
                            onToggleSelect = { onToggleSelect(thread.id) },
                            onToggleStar = { onToggleStar(thread) },
                        )
                    }
                }
                HorizontalDivider(color = colors.borderMuted, thickness = 0.5.dp)
            }

            if (state.loadingMore) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(strokeWidth = 2.dp)
                    }
                }
            }
        }
    }
}

/**
 * The selection toolbar.
 *
 * Built from [actionsFor] and [deletePolicyFor], so the buttons cannot offer
 * something the mailbox does not support. Delete is never behind More — it is
 * the action people entered selection mode for — and it is labelled with what
 * it will actually do, which in Trash and Spam is not "Delete".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SelectionBar(
    count: Int,
    role: String?,
    onClear: () -> Unit,
    onSelectAll: () -> Unit,
    onAction: (MessageAction) -> Unit,
    onDelete: () -> Unit,
) {
    val colors = MailTheme.colors
    val haptics = LocalHaptics.current
    val actions = actionsFor(role)
    val policy = deletePolicyFor(role, count)
    var menuOpen by remember { mutableStateOf(false) }

    val primary = actions.filter { it.primary }
    val overflow = actions.filterNot { it.primary }

    TopAppBar(
        title = {
            Text(
                text = if (count == 1) "1 selected" else "$count selected",
                style = MaterialTheme.typography.titleMedium,
            )
        },
        navigationIcon = {
            IconButton(onClick = onClear) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Clear selection")
            }
        },
        actions = {
            primary.forEach { action ->
                IconButton(onClick = {
                    haptics.perform(Haptic.Press)
                    onAction(action.action)
                }) {
                    Icon(
                        imageVector = iconFor(action.id),
                        contentDescription = action.label,
                    )
                }
            }

            // Delete, worded by the mailbox. In Trash this reads "Delete
            // permanently" to a screen reader, not "Delete".
            IconButton(onClick = {
                haptics.perform(Haptic.Press)
                onDelete()
            }) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = policy.label,
                    tint = colors.danger,
                )
            }

            // No More button when there is nothing behind it — Drafts offers no
            // state actions at all, because a draft was never received.
            if (overflow.isNotEmpty()) {
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "More actions")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Select all on this page") },
                            leadingIcon = { Icon(Icons.Filled.DoneAll, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                haptics.perform(Haptic.Select)
                                onSelectAll()
                            },
                        )
                        overflow.forEach { action ->
                            DropdownMenuItem(
                                text = { Text(action.label) },
                                onClick = {
                                    menuOpen = false
                                    haptics.perform(Haptic.Press)
                                    onAction(action.action)
                                },
                            )
                        }
                    }
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            titleContentColor = colors.ink,
            navigationIconContentColor = colors.ink,
            actionIconContentColor = colors.inkSecondary,
        ),
    )
}

/**
 * The search field, in place of the top bar.
 *
 * The placeholder is the web client's, verbatim. That string is doing real work
 * beyond decoration: `from:`, `has:attachment`, `is:unread` and `newer:7d` are
 * the actual grammar the server accepts, and showing them is how anyone finds
 * out the grammar exists. A generic "Search…" hides the entire feature.
 *
 * Nothing is parsed here. The query goes to the server as typed, and the same
 * shared parser the web's filter chips use turns it into SQL — which is exactly
 * why a chip and the rows returned cannot disagree.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onClose: () -> Unit,
) {
    val colors = MailTheme.colors
    val focusRequester = remember { FocusRequester() }

    // Focus and keyboard on open: tapping search and then having to tap again
    // to type is a wasted tap on every single search.
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    TopAppBar(
        title = {
            TextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                placeholder = {
                    Text(
                        // Scrolls rather than wraps: the hint is longer than a
                        // phone is wide, and truncating it would cut off the
                        // examples that make it useful.
                        text = "Search mail —  from:  has:attachment  is:unread  newer:7d",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                textStyle = MaterialTheme.typography.bodyMedium,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    focusedTextColor = colors.ink,
                    unfocusedTextColor = colors.ink,
                ),
                trailingIcon = {
                    // Clears the text without leaving search — the common case
                    // is refining a query, not abandoning it.
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { onQueryChange("") }) {
                            Icon(Icons.Filled.Close, contentDescription = "Clear search")
                        }
                    }
                },
            )
        },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close search")
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.canvas),
    )
}

/** Icons for the primary actions the policy can return. */
private fun iconFor(actionId: String) = when (actionId) {
    "archive" -> Icons.Filled.Archive
    "restore" -> Icons.Filled.Unarchive
    "spam" -> Icons.Filled.Report
    else -> Icons.Filled.MoreVert
}

@Composable
private fun CenteredProgress() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/**
 * The mailbox's real empty state.
 *
 * The wording comes from the same table the web client uses, so an empty inbox
 * says the same thing on both. Nothing is invented to fill the screen: no
 * sample messages, no illustration standing in for content the account does not
 * have.
 */
@Composable
private fun EmptyState(title: String, body: String) {
    Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = MailTheme.colors.ink)
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MailTheme.colors.inkMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * A failure the user can act on.
 *
 * Retry is offered only where retrying can work. An authorization failure is
 * not retryable and does not pretend to be.
 */
@Composable
private fun ErrorState(error: ApiError, onRetry: () -> Unit) {
    val retryable = error is ApiError.Network || error is ApiError.Server

    Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = error.message,
                style = MaterialTheme.typography.bodyMedium,
                color = MailTheme.colors.ink,
                textAlign = TextAlign.Center,
            )
            if (retryable) {
                TextButton(onClick = onRetry) { Text("Try again") }
            }
        }
    }
}

/**
 * Shows an action's result, offering Undo where the server can genuinely
 * reverse it.
 *
 * The Undo window is the snackbar's lifetime and nothing else: when it leaves,
 * the offer is gone, because there is no queued operation to cancel — the
 * action already happened on the server and Undo is a second call.
 */
suspend fun SnackbarHostState.showAction(event: InboxEvent) {
    when (event) {
        is InboxEvent.Completed -> {
            val result = showSnackbar(
                message = event.message,
                actionLabel = if (event.undo != null) "Undo" else null,
                withDismissAction = event.undo == null,
                duration = if (event.undo != null) SnackbarDuration.Long else SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) event.undo?.invoke()
        }
        is InboxEvent.Failed -> showSnackbar(
            message = event.message,
            withDismissAction = true,
            duration = SnackbarDuration.Long,
        )
    }
}
