import { discoverStorage } from "@/lib/server/storage/discovery";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/storage/discover — what storage this host can actually see.
 *
 * Server-side by necessity: a browser cannot enumerate the host's mounts or
 * the local network, so anything a client-only implementation displayed would
 * be invented.
 *
 * Authenticated because the response is a map of the host's storage, including
 * network shares and their servers. That is reconnaissance for anyone who has
 * no account here.
 *
 * The response reports capabilities alongside resources so an empty list is
 * never ambiguous: "nothing is mounted" and "this platform cannot be scanned"
 * are different answers, and the UI shows which one it got.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const result = await discoverStorage();
    return ok(result);
  });
}
