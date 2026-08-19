import type { NextRequest } from "next/server";
import { preferences, updatePreferences } from "@/lib/server/account";
import { audit } from "@/lib/server/auth";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/account/preferences — appearance, notifications and privacy. */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return ok({ preferences: preferences(auth.user.id) });
  });
}

/**
 * PATCH /api/account/preferences
 *
 * The merge keeps only keys the defaults define and only where the type
 * matches, so an unexpected payload cannot write arbitrary JSON into the
 * settings column. Unknown keys are dropped silently rather than rejected —
 * a newer client sending a field this server does not know about should still
 * be able to save the fields it does.
 */
export async function PATCH(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return fail(400, "invalid_body", "Send a JSON object.");
    }

    const next = updatePreferences(auth.user.id, body);

    // Recorded because privacy choices are security-relevant, but the values
    // themselves are not logged — what a user chose to share is their business.
    audit(auth.user.id, "PROFILE_UPDATED", {
      sections: Object.keys(body as Record<string, unknown>),
    });

    return ok({ preferences: next });
  });
}
