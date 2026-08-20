package com.mailserver.android.data.model

/**
 * The reply kinds the server implements, from ReplyMode in
 * apps/web/lib/server/compose.ts.
 *
 * An enum rather than a string so a mode the server does not know cannot be
 * sent at all. [wire] is the exact token the API expects.
 */
enum class ReplyMode(val wire: String) {
    Reply("reply"),
    ReplyAll("replyAll"),
    Forward("forward"),
}
