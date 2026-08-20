import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { fail, guard, requireUser } from "@/lib/server/http";
import { connectorFor, getConnection } from "@/lib/server/storage/connections";
import { safeRelativePath } from "@/lib/server/storage/connector";
import type { StorageConnector } from "@/lib/server/storage/connector";
import { redact } from "@/lib/server/storage/endpoint-guard";
import { config } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * File contents, streamed both ways.
 *
 * Neither direction buffers. A download pipes the provider's stream straight
 * into the response, and an upload pipes the request body straight into the
 * provider — so a 4 GB file costs a few buffers, not 4 GB of heap, and the
 * server does not fall over because someone moved a video.
 */

type Opened =
  | { error: Response; connector?: undefined }
  | { error?: undefined; connector: StorageConnector };

async function open(id: string): Promise<Opened> {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.response };

  const record = getConnection(auth.user.tenantId, auth.user.id, id);
  if (!record) {
    return { error: fail(404, "not_found", "That storage connection does not exist.") };
  }
  return { connector: connectorFor(record) };
}

/** GET — download. Authorised on every request, never by a signed URL. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const opened = await open(id);
    if (opened.error) return opened.error;

    const path = request.nextUrl.searchParams.get("path") ?? "";
    const relative = safeRelativePath(path);
    if (relative === null || relative === "") {
      return fail(400, "invalid_path", "That path is not allowed.");
    }

    try {
      const entry = await opened.connector.stat(relative);
      const stream = await opened.connector.download(relative);

      const headers = new Headers();
      // Deliberately opaque. Serving the provider's content type would let an
      // uploaded .html run as a document on this origin, with this origin's
      // cookies.
      headers.set("Content-Type", "application/octet-stream");
      headers.set("X-Content-Type-Options", "nosniff");
      // Quotes and backslashes escaped, and the name reduced to its basename,
      // so a crafted filename cannot inject header parameters or a path.
      const filename = basename(relative).replace(/["\\]/g, "_");
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
      if (entry?.size != null) headers.set("Content-Length", String(entry.size));

      return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
    } catch (cause) {
      const message = redact(cause instanceof Error ? cause.message : "That file could not be read.");
      return fail(/not allowed|outside/i.test(message) ? 400 : 404, "download_failed", message);
    }
  });
}

/**
 * PUT — upload.
 *
 * The size limit is enforced while streaming rather than from a header: a
 * declared Content-Length is a claim, and a client can simply keep sending.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const opened = await open(id);
    if (opened.error) return opened.error;

    if (!opened.connector.capabilities().write) {
      return fail(403, "read_only", "This storage is read-only.");
    }

    const path = request.nextUrl.searchParams.get("path") ?? "";
    const relative = safeRelativePath(path);
    if (relative === null || relative === "") {
      return fail(400, "invalid_path", "That path is not allowed.");
    }
    if (!request.body) return fail(400, "empty_body", "Send the file as the request body.");

    const limit = config.maxAttachmentBytes;
    let transferred = 0;

    // Counted mid-stream, and the stream is destroyed the moment the limit is
    // passed, so an oversized upload is stopped rather than measured after it
    // has already landed.
    const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    const counted = new Readable({
      read() {},
    });

    source.on("data", (chunk: Buffer) => {
      transferred += chunk.length;
      if (transferred > limit) {
        source.destroy(new Error(`That file is larger than the ${Math.round(limit / 1024 / 1024)} MB limit.`));
        return;
      }
      if (!counted.push(chunk)) source.pause();
    });
    source.on("end", () => counted.push(null));
    source.on("error", (cause) => counted.destroy(cause));
    counted.on("drain", () => source.resume());

    try {
      await opened.connector.upload(relative, counted);
      return Response.json({ uploaded: relative, bytes: transferred }, { status: 201 });
    } catch (cause) {
      const message = redact(cause instanceof Error ? cause.message : "The upload failed.");
      const refused = /not allowed|outside|read-only|larger than/i.test(message);
      return fail(refused ? 400 : 502, refused ? "refused" : "upload_failed", message);
    }
  });
}
