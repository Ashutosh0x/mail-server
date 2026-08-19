import { publicConfig } from "@/lib/server/config";
import { guard, ok } from "@/lib/server/http";

export const runtime = "nodejs";

/** Limits the client needs. The server enforces all of them again regardless. */
export async function GET() {
  return guard(async () => ok(publicConfig()));
}
