import type { NextRequest } from "next/server";
import { recentRecipients } from "@/lib/server/compose";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recipients?q= — address suggestions.
 *
 * Derived from the caller's OWN sent mail. There is no contact store, and
 * inventing one would be the fake data this project refuses — so every
 * suggestion is an address this user has genuinely written to before.
 *
 * Scoped to the caller throughout: one account's correspondents must never
 * surface in another's suggestions.
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const query = request.nextUrl.searchParams.get("q") ?? "";
    // A blank query would return the whole address book on every keystroke.
    if (query.trim().length === 0) return ok({ recipients: [] });

    return ok({ recipients: recentRecipients(auth.user.id, query) });
  });
}
