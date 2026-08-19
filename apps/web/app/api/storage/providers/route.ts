import { PROVIDERS } from "@mailserver/types";
import { guard, ok, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/storage/providers
 *
 * The registry, as the UI should render it. `status` is the honest bit: a
 * provider with no connector reports `planned` plus the reason, and the client
 * renders it as unavailable rather than as a connect button that fails after
 * the OAuth round trip.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const providers = Object.values(PROVIDERS)
      .filter((provider) => provider.external)
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        status: provider.status,
        auth: provider.auth,
        capabilities: provider.capabilities,
        note: provider.note ?? null,
      }));

    return ok({
      providers,
      connectable: providers.filter((p) => p.status === "available").map((p) => p.id),
    });
  });
}
