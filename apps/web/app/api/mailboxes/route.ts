import { guard, ok, requireUser } from "@/lib/server/http";
import { listMailboxes } from "@/lib/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return ok({ mailboxes: listMailboxes(auth.user.id) });
  });
}
