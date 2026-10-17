import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./betterAuth.js";

/**
 * Auth context contract (formerly "SupabaseAuthContext" - name retained to
 * avoid churning every call site; the implementation is now Better Auth).
 * Kept intentionally narrow to the two fields every route reads off
 * `getAuth(req)`: `userId` and `sessionClaims`. The object itself is never
 * null/undefined - only `userId` is - for unauthenticated requests.
 */
export interface SupabaseAuthContext {
  userId: string | null;
  sessionClaims: Record<string, unknown> | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: SupabaseAuthContext | null;
    }
  }
}

/**
 * Verifies the Better Auth session (via the session cookie) on every incoming
 * request and attaches the result to `req.auth`. Mirrors the permissive
 * behavior of the old Clerk/Supabase middleware: requests with no session, or
 * an invalid/expired one, simply leave `req.auth` unset - each route calls
 * `requireUserId`/`getAuth` to actually enforce authentication (401).
 *
 * This reads the `better-auth.session_token` cookie (set by the Better Auth
 * handler at `/api/auth/*`), not a Bearer token. No network round-trip is
 * required: the session is verified locally against the `session` table.
 */
export async function supabaseAuthMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const headers = fromNodeHeaders(req.headers);
    const result = await auth.api.getSession({ headers });
    if (result?.user && result?.session) {
      const { user } = result;
      req.auth = {
        userId: user.id,
        sessionClaims: { email: user.email ?? null },
      };
    }
  } catch (err) {
    req.log?.warn({ err }, "Better Auth session verification failed");
  }

  next();
}

/**
 * Clerk-compatible accessor: returns the auth context for this request
 * (populated by `supabaseAuthMiddleware`). `userId`/`sessionClaims` are null
 * when the request is unauthenticated, but the returned object is not.
 */
export function getAuth(req: Request): SupabaseAuthContext {
  return req.auth ?? { userId: null, sessionClaims: null };
}
