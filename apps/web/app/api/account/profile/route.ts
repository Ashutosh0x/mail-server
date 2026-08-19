import type { NextRequest } from "next/server";
import { accountProfile, updateProfile } from "@/lib/server/account";
import { audit } from "@/lib/server/auth";
import { guard, ok, fail, requireUser } from "@/lib/server/http";
import { isHeaderSafe, str } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/account/profile
 *
 * Only the three fields a user owns. Email, role, status and quota are
 * deliberately absent: changing an address is an identity operation that needs
 * verification, and the rest are an administrator's to set. Accepting them here
 * because the column exists is how a profile form becomes a privilege
 * escalation.
 */
export async function PATCH(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Send a JSON object.");

    const patch: { displayName?: string; timezone?: string; language?: string } = {};

    if (body.displayName !== undefined) {
      const displayName = str(body.displayName, 120);
      if (!displayName) return fail(400, "invalid_display_name", "Enter a name of 1 to 120 characters.");
      // A display name ends up in a From header. CR/LF there is header
      // injection, so it is refused at the edge rather than escaped later.
      if (!isHeaderSafe(displayName)) {
        return fail(400, "invalid_display_name", "That name contains characters that are not allowed.");
      }
      patch.displayName = displayName;
    }

    if (body.timezone !== undefined) {
      const timezone = str(body.timezone, 64);
      if (!timezone) return fail(400, "invalid_timezone", "Enter a valid time zone.");
      // Validated against the runtime's own tz database rather than a hardcoded
      // list, which would be wrong the moment the database is updated.
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
      } catch {
        return fail(400, "invalid_timezone", `"${timezone}" is not a time zone this server recognises.`);
      }
      patch.timezone = timezone;
    }

    if (body.language !== undefined) {
      const language = str(body.language, 16);
      if (!language || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(language)) {
        return fail(400, "invalid_language", "Enter a language tag such as `en` or `en-GB`.");
      }
      patch.language = language;
    }

    if (Object.keys(patch).length === 0) {
      return fail(400, "nothing_to_update", "Send at least one field to change.");
    }

    updateProfile(auth.user.id, patch);
    audit(auth.user.id, "PROFILE_UPDATED", { fields: Object.keys(patch) });

    return ok({ profile: accountProfile(auth.user.id) });
  });
}
