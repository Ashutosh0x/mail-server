import { Readable } from "node:stream";
import { deleteAttachment, getAttachment } from "@/lib/server/attachments";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { storage } from "@/lib/server/storage";
import { safeDisposition } from "@/lib/server/filetype";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/attachments/:id — stream one attachment back.
 *
 * Ownership is part of the lookup, so changing the id in the URL returns 404
 * rather than another user's file. The response type and disposition come from
 * `safeDisposition`, which refuses to serve HTML or SVG inline from this
 * origin — that would be stored XSS.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const record = getAttachment(auth.user.id, id);
    if (!record) return fail(404, "not_found", "That attachment does not exist.");

    if (record.scanStatus === "infected") {
      return fail(403, "infected", "This attachment was blocked by malware scanning.");
    }

    const node = await storage().get(record.storageKey);
    const { disposition, contentType } = safeDisposition(record.contentType, record.filename);

    return new Response(Readable.toWeb(node) as ReadableStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(record.size),
        "Content-Disposition": disposition,
        // Belt and braces alongside the disposition: even if a type slips
        // through, the browser must not sniff its way to executing it.
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const removed = await deleteAttachment(auth.user.id, id);
    if (!removed) return fail(404, "not_found", "That attachment does not exist.");
    return ok({ deleted: true });
  });
}
