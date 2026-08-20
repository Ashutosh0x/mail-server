import type { NextRequest } from "next/server";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import {
  connectorFor,
  deleteConnection,
  getConnection,
  recordProbe,
  renameConnection,
  setRoles,
  toPublic,
  type StorageRole,
} from "@/lib/server/storage/connections";
import { redact } from "@/lib/server/storage/endpoint-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: StorageRole[] = ["attachments", "files", "archive"];

/** GET — one connection, with a fresh probe and live usage. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const record = getConnection(auth.user.tenantId, auth.user.id, id);
    // 404 rather than 403 for someone else's connection: distinguishing them
    // confirms the id exists, which is the whole of an IDOR probe.
    if (!record) return fail(404, "not_found", "That storage connection does not exist.");

    let probe = null;
    let capabilities = null;
    try {
      const connector = connectorFor(record);
      capabilities = connector.capabilities();
      probe = await connector.testConnection();
      recordProbe(auth.user.tenantId, auth.user.id, id, probe.state, probe.detail);
    } catch (cause) {
      probe = {
        state: "error" as const,
        detail: redact(cause instanceof Error ? cause.message : "That connection could not be opened."),
        usage: { totalBytes: null, usedBytes: null, freeBytes: null },
        latencyMs: null,
        writable: null,
      };
    }

    return ok({ connection: toPublic(record), probe, capabilities });
  });
}

/**
 * PATCH — rename, or set which purposes this storage serves.
 *
 * Roles are stored but nothing reads them yet: mail attachments still go to
 * the configured object-storage driver. Setting a role therefore records an
 * intent rather than moving data, and the UI says so — silently redirecting
 * new mail into freshly connected storage would be a surprise nobody asked
 * for.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    if (!getConnection(auth.user.tenantId, auth.user.id, id)) {
      return fail(404, "not_found", "That storage connection does not exist.");
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Send a JSON object.");

    if (typeof body.displayName === "string") {
      const name = body.displayName.trim();
      if (name.length === 0 || name.length > 100) {
        return fail(400, "invalid_name", "Give this storage a name.");
      }
      renameConnection(auth.user.tenantId, auth.user.id, id, name);
    }

    if (Array.isArray(body.roles)) {
      const roles = body.roles.filter((r): r is StorageRole =>
        typeof r === "string" && ROLES.includes(r as StorageRole)
      );
      setRoles(auth.user.tenantId, auth.user.id, id, roles);
    }

    const updated = getConnection(auth.user.tenantId, auth.user.id, id)!;
    return ok({ connection: toPublic(updated) });
  });
}

/**
 * DELETE — forget the connection.
 *
 * Removes the RECORD ONLY. Nothing on the external storage is touched.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const removed = deleteConnection(auth.user.tenantId, auth.user.id, id);
    if (!removed) return fail(404, "not_found", "That storage connection does not exist.");

    return ok({
      disconnected: true,
      detail: "The connection was removed from Mail Server. Files on the storage were not deleted.",
    });
  });
}
