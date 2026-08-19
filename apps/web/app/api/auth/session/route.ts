import { currentUser } from "@/lib/server/auth";
import { guard, ok } from "@/lib/server/http";
import { usedStorage } from "@/lib/server/attachments";

export const runtime = "nodejs";

export async function GET() {
  return guard(async () => {
    const user = await currentUser();
    if (!user) return ok({ user: null });
    return ok({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        quotaBytes: user.quotaBytes,
        usedBytes: usedStorage(user.id),
      },
    });
  });
}
