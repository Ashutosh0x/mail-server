import type { NextRequest } from "next/server";
import { guard, ok, requireUser } from "@/lib/server/http";
import { queryThreads } from "@/lib/server/mail";
import { config } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mail — the caller's threads.
 *
 * Cursor-paginated. `limit` is clamped server-side: a client asking for a
 * million rows gets `maxPageSize`, not a million rows.
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const params = request.nextUrl.searchParams;
    const requested = Number(params.get("limit") ?? config.defaultPageSize);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(requested, config.maxPageSize))
      : config.defaultPageSize;

    const page = queryThreads(auth.user.id, {
      mailboxId: params.get("mailboxId") ?? undefined,
      labelId: params.get("labelId") ?? undefined,
      search: params.get("q") ?? undefined,
      cursor: params.get("cursor"),
      limit,
    });

    return ok(page);
  });
}
