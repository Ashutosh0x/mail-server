import type { NextRequest } from "next/server";
import { createAccount, RegistrationError } from "@/lib/server/accounts";
import { audit, createSession, setSessionCookie } from "@/lib/server/auth";
import { fail, guard, ok } from "@/lib/server/http";
import { isEmail, isHeaderSafe, passwordProblem, str } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "invalid_body", "Expected a JSON body.");

    const email = body.email;
    if (!isEmail(email)) return fail(400, "invalid_email", "Enter a valid email address.");

    const displayName = str(body.displayName, 120);
    if (!displayName || !isHeaderSafe(displayName)) {
      return fail(400, "invalid_name", "Enter a name without line breaks.");
    }

    const problem = passwordProblem(body.password);
    if (problem) return fail(400, "weak_password", problem);

    try {
      const { userId } = createAccount({ email, password: body.password as string, displayName });
      const { token } = createSession(userId, {
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      });
      await setSessionCookie(token);
      audit(userId, "account.created", { email });
      return ok({ user: { id: userId, email, displayName } }, 201);
    } catch (error) {
      if (error instanceof RegistrationError) {
        // Same wording as a duplicate-address login failure would give, so this
        // endpoint is not an account-enumeration oracle.
        return fail(409, error.code, error.message);
      }
      throw error;
    }
  });
}
