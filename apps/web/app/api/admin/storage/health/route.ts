import { storage, StorageUnavailableError } from "@/lib/server/storage";
import { guard, ok, fail, requireUser } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage/health
 *
 * Runs a REAL probe on every call: write a small object, read it back, compare
 * it, delete it, and time the round trip. Capacity comes from `statfs`, not
 * from configuration.
 *
 * There is deliberately no cached "last known good" answer. A health endpoint
 * that serves a stale success is worse than one that is slow, because the
 * whole point is to notice an outage that started thirty seconds ago.
 *
 * Admin-only. Mount paths, filesystem types and capacity describe the
 * infrastructure, and an ordinary user has no reason to learn where their
 * mail is stored.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    if (auth.user.role !== "admin") {
      // 404 rather than 403: a 403 confirms the endpoint exists and that this
      // deployment has an admin surface worth probing.
      return fail(404, "not_found", "Not found.");
    }

    try {
      const report = await storage().healthCheck();
      // 200 even when unhealthy — the request succeeded, and the state is the
      // payload. A 503 here would make monitoring unable to distinguish
      // "storage is down" from "the API is down".
      return ok({ storage: report });
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        return ok({
          storage: {
            provider: "unknown",
            state: "unavailable" as const,
            detail: error.message,
            checkedAt: new Date().toISOString(),
            latencyMs: null,
            readable: false,
            writable: false,
            capacity: {
              totalBytes: null,
              availableBytes: null,
              usedBytes: null,
              totalInodes: null,
              availableInodes: null,
              filesystemType: null,
            },
          },
        });
      }
      throw error;
    }
  });
}
