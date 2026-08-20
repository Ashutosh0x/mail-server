import type { NextRequest } from "next/server";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import {
  createConnection,
  connectorFor,
  listConnections,
  recordProbe,
  toPublic,
} from "@/lib/server/storage/connections";
import { checkLocalRoot, configuredRoots } from "@/lib/server/storage/local-roots";
import { redact } from "@/lib/server/storage/endpoint-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/storage/connections — the caller's connections.
 *
 * Scoped to their organization and to connections they own or that were shared
 * with them. Credentials are not in the response shape at all — not redacted,
 * absent.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    return ok({
      connections: listConnections(auth.user.tenantId, auth.user.id).map(toPublic),
      /** Whether local connections are possible at all on this deployment. */
      localRootsConfigured: configuredRoots().length > 0,
    });
  });
}

/**
 * POST /api/storage/connections — connect storage.
 *
 * The connection is TESTED BEFORE IT IS SAVED. A row that says "connected"
 * because someone submitted a form is the exact failure this endpoint used to
 * refuse to participate in by returning 501 for everything; now that two
 * connectors are real, the guarantee is kept by probing first and storing the
 * probe's verdict rather than an assumption.
 *
 * Only providers with a working connector are accepted. Everything else still
 * returns 501 with an explanation of what to do instead.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Send a JSON object.");

    const provider = typeof body.provider === "string" ? body.provider : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (displayName.length === 0 || displayName.length > 100) {
      return fail(400, "invalid_name", "Give this storage a name.");
    }

    if (provider === "webdav") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!url || !username || !password) {
        return fail(400, "missing_fields", "URL, username and password are all required.");
      }

      // Probed with the submitted credentials BEFORE anything is written, so a
      // failed connection never leaves a row claiming otherwise.
      const { WebDavConnector } = await import("@/lib/server/storage/webdav");
      const probe = await new WebDavConnector({
        url,
        username,
        password,
        basePath: typeof body.basePath === "string" ? body.basePath : undefined,
      }).testConnection();

      if (probe.state !== "connected" && probe.state !== "read_only") {
        return fail(400, `probe_${probe.state}`, redact(probe.detail));
      }

      const record = createConnection({
        tenantId: auth.user.tenantId,
        userId: auth.user.id,
        provider: "webdav",
        displayName,
        config: { url, ...(body.basePath ? { basePath: String(body.basePath) } : {}) },
        secrets: { username, password },
      });
      recordProbe(auth.user.tenantId, auth.user.id, record.id, probe.state, probe.detail);

      return ok({ connection: toPublic({ ...record, status: "active" }), probe: { ...probe } }, 201);
    }

    if (provider === "local") {
      const path = typeof body.path === "string" ? body.path : "";
      const verdict = checkLocalRoot(path);
      if (!verdict.ok) return fail(403, "root_not_permitted", verdict.reason);

      const record = createConnection({
        tenantId: auth.user.tenantId,
        userId: auth.user.id,
        provider: "local",
        displayName,
        config: { readOnly: body.readOnly === true },
        rootPath: verdict.root,
      });

      // Probed after creation because the connector needs the stored root.
      const probe = await connectorFor(record).testConnection({ probeWrite: true });
      recordProbe(auth.user.tenantId, auth.user.id, record.id, probe.state, probe.detail);

      if (probe.state === "unreachable" || probe.state === "permission_denied") {
        return fail(400, `probe_${probe.state}`, probe.detail);
      }

      return ok({ connection: toPublic(record), probe }, 201);
    }

    // Unchanged for everything without a connector: an explanation, not a row.
    const guidance: Record<string, string> = {
      smb: "Direct SMB connections are not built. Mount the share on the host operating system, then scan again — it will appear under Detected storage.",
      nfs: "Direct NFS mounting is not built. Mount the export on the host operating system, then scan again — it will appear under Detected storage.",
      s3: "S3-compatible storage is not built yet. It needs request signing that has not been written or verified against a real endpoint.",
    };

    if (guidance[provider]) {
      return fail(501, "connector_not_implemented", guidance[provider]!);
    }
    return fail(400, "unknown_provider", "That storage provider does not exist.");
  });
}
