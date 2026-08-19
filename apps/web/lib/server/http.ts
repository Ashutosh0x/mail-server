import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { currentUser, type SessionUser } from "./auth";

/**
 * Shared response shape and the auth guard.
 *
 * One error envelope everywhere: `{ error: { code, message, requestId } }`.
 * A client that has to guess the shape per endpoint ends up with a `catch` that
 * shows "Something went wrong" for everything.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

export function fail(status: number, code: string, message: string): NextResponse<ApiErrorBody> {
  const requestId = randomUUID();
  // The message is written for a user. Stack traces and driver errors never
  // reach this function — see the `catch` in each route.
  return NextResponse.json({ error: { code, message, requestId } }, { status });
}

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Resolve the caller, or return a 401 response.
 *
 * Returns a discriminated union rather than throwing, so a route cannot
 * accidentally continue past a failed check — there is no value to use unless
 * `ok` is true.
 */
export async function requireUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  const user = await currentUser();
  if (!user) {
    return { ok: false, response: fail(401, "unauthenticated", "Sign in to continue.") };
  }
  return { ok: true, user };
}

/**
 * Wrap a handler so an unexpected throw becomes a 500 without leaking detail.
 *
 * Typed against `Response`, not `NextResponse<T>`: a route that streams a file
 * returns a plain `Response`, and a union of success shapes is not assignable
 * to a single `NextResponse<T>`. Narrowing here bought nothing and rejected
 * correct routes.
 */
export async function guard(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    console.error("[api] unhandled", error);
    return fail(500, "internal_error", "Something went wrong on our side. Please try again.");
  }
}
