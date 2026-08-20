import { createDraft, authorizedSenders } from "@/lib/server/compose";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drafts — start a draft.
 *
 * The From address comes from the account, never from the request. A From the
 * client can choose is a From anyone can forge, which is exactly what
 * SPF/DKIM/DMARC exist downstream to prevent.
 */
export async function POST() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const senders = authorizedSenders(auth.user.id);
    if (senders.length === 0) {
      return fail(409, "no_sender", "This account has no address to send from.");
    }

    const id = createDraft(auth.user.id, senders[0]!);
    return ok({ draftId: id, senders }, 201);
  });
}
