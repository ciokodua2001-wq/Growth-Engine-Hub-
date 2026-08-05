import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "./supabaseClient.js";

/**
 * Clerk-compatible auth context, kept intentionally narrow to the two fields
 * every route in this codebase actually reads off Clerk's `getAuth(req)`
 * result: `userId` and `sessionClaims`. Like Clerk's real `getAuth()`, this
 * object itself is never null/undefined — only `userId` is, for
 * unauthenticated requests — since a lot of call sites rely on that exact
 * contract (e.g. `getAuth(req).sessionClaims` with no optional chaining).
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
 * Verifies the Supabase access token (if any) on every incoming request and
 * attaches the result to `req.auth`. Mirrors the permissive behavior of
 * Clerk's `clerkMiddleware`: requests with no token, or an invalid one,
 * simply get `req.auth` left unset — it's up to each route to call
 * `requireUserId`/`getAuth` to actually enforce authentication (401).
 *
 * Verification is done via `supabase.auth.getUser(token)`, which asks the
 * Supabase Auth server to validate the token. That works regardless of
 * whether this project uses legacy symmetric (HS256) or the newer asymmetric
 * JWT signing keys, at the cost of one extra network round-trip per
 * authenticated request. If that becomes a bottleneck, switch to local
 * verification via `jose` + this project's JWKS endpoint — see
 * https://supabase.com/docs/guides/auth/jwts.
 */
export async function supabaseAuthMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    next();
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data.user) {
      req.auth = {
        userId: data.user.id,
        sessionClaims: { ...(data.user.user_metadata ?? {}), email: data.user.email ?? null },
      };
    }
  } catch (err) {
    req.log?.warn({ err }, "Supabase token verification failed");
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
