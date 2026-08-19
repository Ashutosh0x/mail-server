import { storageUsage } from "@/lib/server/account";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/account/storage — real usage, summed per request. */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return ok({
      storage: storageUsage(auth.user.id),
      /** Cleanup tooling does not exist; the client must not offer it. */
      unavailable: { cleanupTools: "Storage cleanup tools are not built yet." },
    });
  });
}
