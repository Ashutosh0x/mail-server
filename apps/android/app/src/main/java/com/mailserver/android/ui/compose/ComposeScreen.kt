package com.mailserver.android.ui.compose

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mailserver.android.data.model.DraftAttachment
import com.mailserver.android.ui.haptics.Haptic
import com.mailserver.android.ui.haptics.LocalHaptics
import com.mailserver.android.ui.theme.MailTheme

/**
 * Writing one message.
 *
 * A full screen rather than a sheet. A composer that shares the screen with the
 * mailbox is a composer that fights the keyboard for the little space left, and
 * on a phone the keyboard takes roughly half of it.
 *
 * The save indicator says only what the server has confirmed — "Saved" is
 * unreachable except from a successful response, which is the point of
 * [SaveState].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeScreen(
    state: ComposeState,
    onToChange: (String) -> Unit,
    onCcChange: (String) -> Unit,
    onBccChange: (String) -> Unit,
    onSubjectChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onToggleCcBcc: () -> Unit,
    onAcceptSuggestion: (String) -> Unit,
    onAttach: (android.net.Uri) -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onDismissFailedUpload: (String) -> Unit,
    onSend: () -> Unit,
    onClose: () -> Unit,
    onDiscard: () -> Unit,
    onRetrySave: () -> Unit,
    onOverwrite: () -> Unit,
    onDiscardMine: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MailTheme.colors
    val haptics = LocalHaptics.current
    var confirmingDiscard by remember { mutableStateOf(false) }

    // The system document picker. Not a custom file browser: the platform's
    // picker already reaches Drive, Photos, Downloads and every other provider
    // on the device, and none of that is reachable from an app-private one.
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris -> uris.forEach(onAttach) }

    /** Closing keeps the draft; discarding is an explicit, confirmed choice. */
    fun requestClose() {
        if (state.hasContent) onClose() else confirmingDiscard = true
    }

    BackHandler { requestClose() }

    Scaffold(
        modifier = modifier.imePadding(),
        containerColor = colors.canvas,
        topBar = {
            TopAppBar(
                title = { Text("New message", style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = { requestClose() }) {
                        Icon(Icons.Filled.Close, contentDescription = "Close")
                    }
                },
                actions = {
                    IconButton(
                        onClick = { picker.launch(arrayOf("*/*")) },
                        enabled = !state.sending,
                    ) {
                        Icon(Icons.Filled.AttachFile, contentDescription = "Attach a file")
                    }
                    IconButton(
                        onClick = {
                            haptics.perform(Haptic.Send)
                            onSend()
                        },
                        enabled = state.canSend,
                    ) {
                        if (state.sending) {
                            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        } else {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = colors.canvas,
                    titleContentColor = colors.ink,
                ),
            )
        },
    ) { padding ->
        if (state.loading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        state.loadError?.let { error ->
            Box(Modifier.fillMaxSize().padding(padding).padding(32.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error.message, color = colors.ink, style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = onClose) { Text("Close") }
                }
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            SaveIndicator(state.saveState, onRetrySave, onOverwrite, onDiscardMine)

            // From is shown only when there is a choice to make. One authorised
            // address means one possible answer, and a disabled picker showing
            // it is a control that cannot be operated.
            if (state.senders.size > 1) {
                FieldRow(label = "From") {
                    Text(
                        text = state.from ?: state.senders.first().email,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.ink,
                    )
                }
                HorizontalDivider(color = colors.borderMuted)
            }

            FieldRow(
                label = "To",
                trailing = {
                    TextButton(onClick = onToggleCcBcc) {
                        Text(if (state.showCcBcc) "Hide Cc/Bcc" else "Cc/Bcc")
                    }
                },
            ) {
                PlainField(state.to, onToChange, "")
            }
            HorizontalDivider(color = colors.borderMuted)

            if (state.showCcBcc) {
                FieldRow(label = "Cc") { PlainField(state.cc, onCcChange, "") }
                HorizontalDivider(color = colors.borderMuted)
                FieldRow(label = "Bcc") { PlainField(state.bcc, onBccChange, "") }
                HorizontalDivider(color = colors.borderMuted)
            }

            FieldRow(label = "Subject") { PlainField(state.subject, onSubjectChange, "") }
            HorizontalDivider(color = colors.borderMuted)

            // Completions appear directly under the field being typed into.
            if (state.suggestions.isNotEmpty()) {
                Suggestions(state, onAcceptSuggestion)
                HorizontalDivider(color = colors.borderMuted)
            }

            if (state.attachments.isNotEmpty() || state.uploading.isNotEmpty()) {
                Attachments(state, onRemoveAttachment, onDismissFailedUpload)
                HorizontalDivider(color = colors.borderMuted)
            }

            OutlinedTextField(
                value = state.body,
                onValueChange = onBodyChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 240.dp)
                    .padding(horizontal = 4.dp),
                placeholder = { Text("Write your message", color = colors.inkMuted) },
                textStyle = MaterialTheme.typography.bodyLarge,
                colors = transparentFieldColors(),
            )

            Spacer(Modifier.height(32.dp))
        }
    }

    if (confirmingDiscard) {
        AlertDialog(
            onDismissRequest = { confirmingDiscard = false },
            title = { Text("Discard this draft?") },
            text = {
                Text(
                    "Deleting a draft removes it and its attachments for good. " +
                        "It cannot be undone."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDiscard = false
                    haptics.perform(Haptic.ConfirmDestructive)
                    onDiscard()
                }) {
                    Text("Delete draft", color = colors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    confirmingDiscard = false
                    onClose()
                }) { Text("Keep draft") }
            },
            containerColor = colors.surfaceRaised,
        )
    }
}

/**
 * What the server has actually confirmed about this draft.
 *
 * Every state is distinct because they mean different things: Offline is "not
 * yet", Conflict is "someone else did", Failed is "the server said no". A
 * single "not saved" would collapse three different next actions into one.
 */
@Composable
private fun SaveIndicator(
    state: SaveState,
    onRetry: () -> Unit,
    onOverwrite: () -> Unit,
    onDiscardMine: () -> Unit,
) {
    val colors = MailTheme.colors

    when (state) {
        is SaveState.Idle -> Unit

        is SaveState.Saving -> Status("Saving…", colors.inkMuted)

        is SaveState.Saved -> Status("Saved", colors.inkMuted)

        is SaveState.Offline -> Status(
            "Not saved — you appear to be offline. It will be saved when the connection returns.",
            colors.warning,
        )

        is SaveState.Failed -> Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = state.message,
                style = MaterialTheme.typography.bodySmall,
                color = colors.danger,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onRetry) { Text("Retry") }
        }

        is SaveState.Conflict -> Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.warningMuted)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Text(
                text = state.message,
                style = MaterialTheme.typography.bodySmall,
                color = colors.ink,
            )
            Row {
                // Neither option is the default. Picking one automatically
                // would discard someone's typing without asking which.
                TextButton(onClick = onOverwrite) { Text("Keep mine") }
                TextButton(onClick = onDiscardMine) { Text("Use theirs") }
            }
        }
    }
}

@Composable
private fun Status(text: String, color: Color) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
    )
}

@Composable
private fun FieldRow(
    label: String,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MailTheme.colors.inkMuted,
            modifier = Modifier.width(64.dp),
        )
        Box(Modifier.weight(1f)) { content() }
        trailing?.invoke()
    }
}

/** A borderless field, so the rows read as a header block rather than a form. */
@Composable
private fun PlainField(value: String, onChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        placeholder = if (placeholder.isNotEmpty()) {
            { Text(placeholder, color = MailTheme.colors.inkMuted) }
        } else null,
        textStyle = MaterialTheme.typography.bodyMedium,
        colors = transparentFieldColors(),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun transparentFieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Color.Transparent,
    unfocusedContainerColor = Color.Transparent,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    focusedTextColor = MailTheme.colors.ink,
    unfocusedTextColor = MailTheme.colors.ink,
)

@Composable
private fun Suggestions(state: ComposeState, onAccept: (String) -> Unit) {
    val colors = MailTheme.colors
    LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp)) {
        items(state.suggestions, key = { it.email }) { suggestion ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onAccept(suggestion.email) }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    // These are addresses the account has genuinely
                    // corresponded with — the server derives them from stored
                    // messages. Nothing is invented to pad the list.
                    suggestion.name?.takeIf(String::isNotBlank)?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.ink)
                    }
                    Text(
                        suggestion.email,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.inkMuted,
                    )
                }
            }
        }
    }
}

@Composable
private fun Attachments(
    state: ComposeState,
    onRemove: (String) -> Unit,
    onDismissFailed: (String) -> Unit,
) {
    val colors = MailTheme.colors

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        state.attachments.forEach { attachment ->
            AttachmentRow(attachment) { onRemove(attachment.id) }
        }

        state.uploading.forEach { pending ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surfaceSunken, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (pending.error != null) {
                        Icon(
                            Icons.Filled.Error,
                            contentDescription = null,
                            tint = colors.danger,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        text = pending.filename,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (pending.error != null) {
                        // The failed row STAYS until dismissed. A file that
                        // silently fails to attach is one the sender discovers
                        // is missing only after the message has gone.
                        TextButton(onClick = { onDismissFailed(pending.localId) }) { Text("Remove") }
                    }
                }

                if (pending.error != null) {
                    Text(
                        text = pending.error,
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.danger,
                    )
                } else {
                    Spacer(Modifier.height(6.dp))
                    // Indeterminate, honestly: the upload is streamed with no
                    // known content length, so a percentage would be invented.
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun AttachmentRow(attachment: DraftAttachment, onRemove: () -> Unit) {
    val colors = MailTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surfaceSunken, RoundedCornerShape(8.dp))
            .padding(start = 12.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = attachment.filename,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = formatBytes(attachment.size),
                style = MaterialTheme.typography.labelSmall,
                color = colors.inkMuted,
            )
        }
        IconButton(onClick = onRemove) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Remove ${attachment.filename}",
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** Binary units, matching the server's own reporting. */
internal fun formatBytes(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    bytes < 1024L * 1024 * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024))
    else -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
}
