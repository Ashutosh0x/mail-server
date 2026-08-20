import type { NextRequest } from "next/server";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { connectorFor, getConnection } from "@/lib/server/storage/connections";
import { isSafeName, safeRelativePath } from "@/lib/server/storage/connector";
import { redact } from "@/lib/server/storage/endpoint-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * File operations on one storage connection.
 *
 * Authorisation happens once, at the top, and produces the connector — there
 * is no path through this file that reaches storage without it. The connector
 * itself owns path confinement, so a route cannot forget to apply the root.
 */
async function withConnector(
  id: string,
  handler: (
    connector: Awaited<ReturnType<typeof connectorFor>>,
    record: NonNullable<ReturnType<typeof getConnection>>
  ) => Promise<Response>
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const record = getConnection(auth.user.tenantId, auth.user.id, id);
  if (!record) return fail(404, "not_found", "That storage connection does not exist.");

  try {
    return await handler(connectorFor(record), record);
  } catch (cause) {
    const message = redact(cause instanceof Error ? cause.message : "That operation failed.");
    // Refusals are the caller's fault; anything else is the storage's.
    const refused = /not allowed|outside the storage root|read-only|cannot be deleted/i.test(message);
    return fail(refused ? 400 : 502, refused ? "refused" : "storage_error", message);
  }
}

/** GET — list one directory. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    return withConnector(id, async (connector) => {
      const path = request.nextUrl.searchParams.get("path") ?? "";
      if (safeRelativePath(path) === null) {
        return fail(400, "invalid_path", "That path is not allowed.");
      }

      const entries = await connector.list(path);
      // Folders first, then by name — the order a file browser is read in.
      entries.sort((a, b) =>
        a.isDirectory === b.isDirectory
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
          : a.isDirectory
            ? -1
            : 1
      );

      return ok({
        path: safeRelativePath(path),
        entries,
        capabilities: connector.capabilities(),
        usage: await connector.getUsage(),
      });
    });
  });
}

type Operation = "mkdir" | "rename" | "move" | "copy" | "delete";

/**
 * POST — mutate.
 *
 * One endpoint rather than five, because every one of them needs the same
 * authorisation, the same path checks and the same error mapping, and five
 * copies of that is five chances to omit one.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    return withConnector(id, async (connector) => {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return fail(400, "invalid_body", "Send a JSON object.");

      const operation = body.operation as Operation;
      const path = typeof body.path === "string" ? body.path : "";

      if (safeRelativePath(path) === null) {
        return fail(400, "invalid_path", "That path is not allowed.");
      }

      const writes: Operation[] = ["mkdir", "rename", "move", "copy", "delete"];
      if (writes.includes(operation) && !connector.capabilities().write) {
        return fail(403, "read_only", "This storage is read-only.");
      }

      switch (operation) {
        case "mkdir": {
          const name = typeof body.name === "string" ? body.name : "";
          if (!isSafeName(name)) return fail(400, "invalid_name", "That folder name is not allowed.");
          await connector.mkdir([safeRelativePath(path), name].filter(Boolean).join("/"));
          return ok({ created: name });
        }

        case "rename": {
          const name = typeof body.name === "string" ? body.name : "";
          // A "name" containing a separator is a path, and renaming would move
          // the file somewhere the user did not choose.
          if (!isSafeName(name)) return fail(400, "invalid_name", "That name is not allowed.");
          const parent = (safeRelativePath(path) ?? "").split("/").slice(0, -1).join("/");
          await connector.move(path, [parent, name].filter(Boolean).join("/"));
          return ok({ renamed: name });
        }

        case "move":
        case "copy": {
          const to = typeof body.to === "string" ? body.to : "";
          if (safeRelativePath(to) === null) {
            return fail(400, "invalid_path", "That destination is not allowed.");
          }
          if (operation === "move") await connector.move(path, to);
          else await connector.copy(path, to);
          return ok({ [operation === "move" ? "moved" : "copied"]: to });
        }

        case "delete": {
          await connector.delete(path, { recursive: body.recursive === true });
          return ok({ deleted: path });
        }

        default:
          return fail(400, "unknown_operation", "That is not a file operation.");
      }
    });
  });
}
