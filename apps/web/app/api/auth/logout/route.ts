import { audit, clearSessionCookie, currentUser, revokeCurrentSession } from "@/lib/server/auth";
import { guard, ok } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST() {
  return guard(async () => {
    const user = await currentUser();
    // Revoke server-side BEFORE clearing the cookie: clearing first would leave
    // a live session row that a copied cookie could still use.
    await revokeCurrentSession();
    await clearSessionCookie();
    if (user) audit(user.id, "auth.logout", {});
    return ok({ ok: true });
  });
}
