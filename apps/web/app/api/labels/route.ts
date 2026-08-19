import type { NextRequest } from "next/server";
import { LABEL_COLORS, type Label } from "@mailserver/types";
import { fail, guard, ok, requireUser } from "@/lib/server/http";
import { createLabel, listLabels } from "@/lib/server/mail";
import { isHeaderSafe, str } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    return ok({ labels: listLabels(auth.user.id) });
  });
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const name = str(body?.name, 64);
    if (!name || !isHeaderSafe(name)) return fail(400, "invalid_name", "Enter a label name.");

    const color = body?.color as Label["color"];
    if (!LABEL_COLORS.includes(color)) {
      return fail(400, "invalid_color", `Colour must be one of: ${LABEL_COLORS.join(", ")}.`);
    }

    try {
      return ok({ label: createLabel(auth.user.id, name, color) }, 201);
    } catch {
      return fail(409, "duplicate_label", "You already have a label with that name.");
    }
  });
}
