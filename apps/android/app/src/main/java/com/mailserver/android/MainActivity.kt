package com.mailserver.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mailserver.android.data.MailRepository
import com.mailserver.android.data.model.ReplyMode
import com.mailserver.android.data.auth.PasskeySupport
import com.mailserver.android.data.auth.SessionStore
import com.mailserver.android.ui.auth.AuthState
import com.mailserver.android.ui.auth.AuthViewModel
import com.mailserver.android.ui.auth.PasskeyPrompt
import com.mailserver.android.ui.auth.SignInScreen
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.compose.ComposeEvent
import com.mailserver.android.ui.compose.ComposeScreen
import com.mailserver.android.ui.compose.ComposeViewModel
import com.mailserver.android.ui.compose.resolvePickedFile
import com.mailserver.android.ui.haptics.rememberHapticFeedbackManager
import com.mailserver.android.ui.inbox.InboxScreen
import com.mailserver.android.ui.inbox.InboxViewModel
import com.mailserver.android.ui.inbox.showAction
import com.mailserver.android.ui.nav.MailDrawerSheet
import com.mailserver.android.ui.theme.MailServerTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val app = application as MailServerApp

        setContent {
            MailServerTheme {
                // Provided once, at the root, so every screen shares one
                // manager and one set of rules. Scattering vibration calls
                // through components is how an app ends up buzzing at
                // everything — see the note in Haptics.kt.
                val haptics = rememberHapticFeedbackManager(
                    // The in-app preference lands here when the Account screen
                    // exists. Until there is a real stored value to read, this
                    // returns the honest default rather than a fake setting.
                    enabled = { true }
                )
                androidx.compose.runtime.CompositionLocalProvider(LocalHaptics provides haptics) {
                    MailServerRoot(app.repository, app.sessionStore)
                }
            }
        }
    }
}

/**
 * The one branch that decides what the app is.
 *
 * Signed-out and signed-in are different trees rather than different routes in
 * one graph: a signed-out user must not be able to reach a mail screen by any
 * navigation action, and the surest way to guarantee that is for those screens
 * not to be in the graph at all.
 *
 * [AuthState.Resolving] is a real state with its own UI. Rendering the sign-in
 * screen while the stored session is still being checked would flash a login
 * form at an already-signed-in user on every cold start.
 */
@Composable
private fun MailServerRoot(repository: MailRepository, store: SessionStore) {
    val authViewModel: AuthViewModel = viewModel(
        factory = viewModelFactory { AuthViewModel(repository, store) }
    )
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    val form by authViewModel.form.collectAsStateWithLifecycle()

    when (authState) {
        is AuthState.Resolving -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }

        is AuthState.SignedOut -> {
            val context = LocalContext.current
            val scope = rememberCoroutineScope()

            // Computed once from the build's base URL, not per recomposition.
            // A passkey button that appears where it could only fail is worse
            // than no button — see PasskeySupport for what "could work" means.
            val passkeysSupported = remember {
                PasskeySupport.isAvailable(BuildConfig.BASE_URL)
            }

            SignInScreen(
                form = form,
                passkeysSupported = passkeysSupported,
                onEmailChange = authViewModel::onEmailChange,
                onPasswordChange = authViewModel::onPasswordChange,
                onDisplayNameChange = authViewModel::onDisplayNameChange,
                onToggleMode = authViewModel::toggleMode,
                onSubmit = authViewModel::submit,
                onPasskeySignIn = {
                    // Three steps, and the middle one is the platform's. The
                    // ViewModel fetches the challenge, the system sheet runs
                    // here where there is an Activity to host it, and the
                    // result goes back to the ViewModel.
                    authViewModel.beginPasskeySignIn { options ->
                        scope.launch {
                            when (val outcome = PasskeyPrompt.authenticate(context, options)) {
                                is PasskeyPrompt.Outcome.Success ->
                                    authViewModel.completePasskeySignIn(outcome.assertion)
                                is PasskeyPrompt.Outcome.Cancelled ->
                                    authViewModel.cancelPasskeySignIn()
                                is PasskeyPrompt.Outcome.Failed ->
                                    authViewModel.failPasskeySignIn(outcome.message)
                            }
                        }
                    }
                },
            )
        }

        is AuthState.SignedIn -> SignedIn(
            user = (authState as AuthState.SignedIn).user,
            repository = repository,
            onSessionExpired = authViewModel::onSessionExpired,
            onSignOut = authViewModel::signOut,
        )
    }
}

/**
 * The mail shell: drawer, list, and the back hierarchy that connects them.
 */
@Composable
private fun SignedIn(
    user: com.mailserver.android.data.model.SessionUser?,
    repository: MailRepository,
    onSessionExpired: () -> Unit,
    onSignOut: () -> Unit,
) {
    val inboxViewModel: InboxViewModel = viewModel(
        factory = viewModelFactory { InboxViewModel(repository, onSessionExpired) }
    )
    val state by inboxViewModel.state.collectAsStateWithLifecycle()

    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val snackbarHost = remember { SnackbarHostState() }

    /**
     * Which composer, if any, is open.
     *
     * Held as state rather than a nav route because the composer sits OVER the
     * mailbox: the list keeps its scroll position and its selection, and
     * closing the composer returns to exactly what was there. A nav push would
     * rebuild the list from scratch every time someone opened and abandoned a
     * reply.
     */
    var composing by remember { mutableStateOf<ComposeRequest?>(null) }

    // Action outcomes arrive as events, not as state: replaying them from state
    // would re-announce "Archived" on every rotation.
    LaunchedEffect(inboxViewModel) {
        inboxViewModel.events.collect { snackbarHost.showAction(it) }
    }

    /**
     * The back hierarchy §42 asks for, in priority order.
     *
     * Drawer first, then selection mode. Each is a mode the user entered and
     * expects Back to leave, and handling them in the wrong order means Back
     * exits a selection while a drawer is still covering the screen.
     *
     * Conversation and compose join this list as their screens land; the
     * enabled guard means the system default — leaving the app — still applies
     * when none of these modes is active, which is what a user expects from the
     * mailbox root.
     */
    BackHandler(enabled = drawerState.isOpen) {
        scope.launch { drawerState.close() }
    }
    BackHandler(enabled = !drawerState.isOpen && state.inSelectionMode) {
        inboxViewModel.clearSelection()
    }
    BackHandler(enabled = !drawerState.isOpen && !state.inSelectionMode && state.searching) {
        inboxViewModel.closeSearch()
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        // Swipe-to-open is disabled during a selection: a horizontal drag then
        // belongs to the rows, and having it pull the drawer instead makes the
        // selection feel broken.
        gesturesEnabled = !state.inSelectionMode,
        drawerContent = {
            MailDrawerSheet(
                user = user,
                mailboxes = state.mailboxes,
                labels = emptyList(),
                selectedMailboxId = state.selectedMailboxId,
                onSelectMailbox = { id ->
                    scope.launch { drawerState.close() }
                    inboxViewModel.selectMailbox(id)
                },
                onSignOut = {
                    scope.launch { drawerState.close() }
                    onSignOut()
                },
            )
        },
    ) {
        InboxScreen(
            state = state,
            onRefresh = inboxViewModel::refresh,
            onLoadMore = inboxViewModel::loadMore,
            // Phase 2 opens the conversation. Deliberately inert rather than
            // navigating to a placeholder screen — a stub that looks like a
            // feature is how a parity matrix starts lying.
            onOpenThread = { },
            onToggleSelect = inboxViewModel::toggleSelection,
            onToggleStar = inboxViewModel::toggleStar,
            onSelectAll = inboxViewModel::selectAllLoaded,
            onClearSelection = inboxViewModel::clearSelection,
            onBulkAction = inboxViewModel::applyToSelection,
            onThreadAction = inboxViewModel::applyToThread,
            onRequestDelete = inboxViewModel::requestDelete,
            onConfirmDelete = inboxViewModel::confirmDelete,
            onCancelDelete = inboxViewModel::cancelDelete,
            onOpenDrawer = { scope.launch { drawerState.open() } },
            onCompose = { composing = ComposeRequest.Blank },
            onQueryChange = inboxViewModel::onQueryChange,
            onOpenSearch = inboxViewModel::openSearch,
            onCloseSearch = inboxViewModel::closeSearch,
            snackbarHost = snackbarHost,
        )
    }

    composing?.let { request ->
        Composer(
            request = request,
            repository = repository,
            onSessionExpired = onSessionExpired,
            onDismiss = {
                composing = null
                // The Drafts mailbox and its count both change when a draft is
                // created, saved or sent, so the list is re-read rather than
                // left showing what was true before the composer opened.
                inboxViewModel.refresh()
            },
            onNotify = { message -> scope.launch { snackbarHost.showSnackbar(message) } },
        )
    }
}

/** Which composer to open. */
sealed interface ComposeRequest {
    data object Blank : ComposeRequest
    data class Reply(val mode: ReplyMode, val sourceMessageId: String) : ComposeRequest
    data class Existing(val draftId: String) : ComposeRequest
}

/**
 * The composer, with its own ViewModel scoped to this request.
 *
 * `key` is the request itself, so opening a reply after a blank compose builds
 * a fresh ViewModel rather than reusing one still holding the previous draft's
 * id and version.
 */
@Composable
private fun Composer(
    request: ComposeRequest,
    repository: MailRepository,
    onSessionExpired: () -> Unit,
    onDismiss: () -> Unit,
    onNotify: (String) -> Unit,
) {
    val context = LocalContext.current

    val viewModel: ComposeViewModel = viewModel(
        key = request.toString(),
        factory = viewModelFactory { ComposeViewModel(repository, onSessionExpired) },
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(request) {
        when (request) {
            is ComposeRequest.Blank -> viewModel.startBlank()
            is ComposeRequest.Reply -> viewModel.startReply(request.mode, request.sourceMessageId)
            is ComposeRequest.Existing -> viewModel.openDraft(request.draftId)
        }
    }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is ComposeEvent.Sent -> onNotify(event.message)
                is ComposeEvent.Failed -> onNotify(event.message)
                is ComposeEvent.Dismiss -> onDismiss()
            }
        }
    }

    ComposeScreen(
        state = state,
        onToChange = viewModel::onToChange,
        onCcChange = viewModel::onCcChange,
        onBccChange = viewModel::onBccChange,
        onSubjectChange = viewModel::onSubjectChange,
        onBodyChange = viewModel::onBodyChange,
        onToggleCcBcc = viewModel::toggleCcBcc,
        onAcceptSuggestion = viewModel::acceptSuggestion,
        onAttach = { uri ->
            // Resolved to a real name and type before upload. A provider that
            // will not say what the file is called is reported, not guessed at:
            // sending "file" when the user picked "contract-final.pdf" is a
            // silent corruption of what they meant to send.
            val picked = resolvePickedFile(context, uri)
            if (picked == null) {
                onNotify("That file could not be read.")
            } else {
                viewModel.attach(picked.filename, picked.contentType, picked.sizeBytes) {
                    context.contentResolver.openInputStream(picked.uri)
                        ?: error("The file could not be opened.")
                }
            }
        },
        onRemoveAttachment = viewModel::removeAttachment,
        onDismissFailedUpload = viewModel::dismissFailedUpload,
        onSend = viewModel::send,
        onClose = viewModel::closeKeepingDraft,
        onDiscard = viewModel::discardDraft,
        onRetrySave = viewModel::retrySave,
        onOverwrite = viewModel::overwriteConflict,
        onDiscardMine = viewModel::discardMine,
    )
}

/** Minimal factory so ViewModels can take constructor arguments. */
private inline fun <reified T : ViewModel> viewModelFactory(
    crossinline create: () -> T,
): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <VM : ViewModel> create(modelClass: Class<VM>): VM = create() as VM
}
