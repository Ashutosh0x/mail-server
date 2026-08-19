import type { NextRequest } from "next/server";
import { PROVIDERS, type ProviderId } from "@mailserver/types";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/storage/connections — the caller's connections.
 *
 * Scoped to the user's organization AND to connections they own or that were
 * shared with them. Credentials are never in the response shape at all — not
 * redacted, absent.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const rows = db()
      .prepare(
        `SELECT id, provider, display_name, status, last_sync_at, created_at
           FROM storage_connections
          WHERE organization_id = ?
            AND (owner_user_id = ? OR owner_user_id IS NULL)
          ORDER BY created_at DESC`
      )
      .all(auth.user.tenantId, auth.user.id) as Record<string, unknown>[];

    return ok({
      connections: rows.map((row) => ({
        id: row.id as string,
        provider: row.provider as string,
        displayName: row.display_name as string,
        state: row.status as string,
        lastSyncAt: (row.last_sync_at as string | null) ?? null,
        createdAt: row.created_at as string,
      })),
    });
  });
}

/**
 * POST /api/storage/connections
 *
 * Refuses every provider until a connector exists. This is the endpoint that
 * would otherwise become the fake connection: accepting credentials, writing a
 * row, and reporting "Connected" for something that can never list a file.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const provider = body?.provider as ProviderId;

    const descriptor = PROVIDERS[provider];
    if (!descriptor || !descriptor.external) {
      return fail(400, "unknown_provider", "That storage provider does not exist.");
    }

    if (descriptor.status !== "available") {
      return fail(
        501,
        "connector_not_implemented",
        `${descriptor.label} cannot be connected yet. ${descriptor.note ?? ""}`.trim()
      );
    }

    // Unreachable while every external provider is `planned`. Left explicit so
    // the failure is a missing branch at review time, not a silent success.
    return fail(
      500,
      "connector_missing",
      `${descriptor.label} is marked available but no connector is wired. This is a bug.`
    );
  });
}
