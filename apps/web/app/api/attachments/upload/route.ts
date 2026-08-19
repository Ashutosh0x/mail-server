import type { NextRequest } from "next/server";
import { ingestAttachment, UploadRejected } from "@/lib/server/attachments";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { config } from "@/lib/server/config";

export const runtime = "nodejs";
// Streamed straight to storage; nothing is buffered by the framework.
export const dynamic = "force-dynamic";

/**
 * POST /api/attachments/upload
 *
 * The body IS the file. Filename and declared type arrive as headers rather
 * than as multipart fields, so the route never has to parse a multipart body
 * into memory to find where the file starts — which is what makes a 100 MB
 * upload cost a few chunks of heap instead of 100 MB.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const filename = request.headers.get("x-filename");
    if (!filename) return fail(400, "missing_filename", "Send the file name in the X-Filename header.");

    if (!request.body) return fail(400, "empty_body", "The request had no file content.");

    // An honest Content-Length lets us reject before reading a byte. A dishonest
    // one changes nothing — the stream is capped regardless.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > config.maxAttachmentBytes) {
      return fail(
        413,
        "too_large",
        `That file is larger than the ${Math.floor(config.maxAttachmentBytes / 1024 / 1024)} MB limit.`
      );
    }

    try {
      const record = await ingestAttachment(auth.user.id, request.body, {
        filename: decodeURIComponent(filename),
        declaredType: request.headers.get("content-type"),
      });
      return ok({ attachment: record }, 201);
    } catch (error) {
      if (error instanceof UploadRejected) {
        const status = error.code === "too_large" ? 413 : error.code === "quota_exceeded" ? 507 : 400;
        return fail(status, error.code, error.message);
      }
      throw error;
    }
  });
}
