import type { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "../lib/supabaseAuth.js";

/**
 * Requests that must stay reachable even for a signed-in-but-not-yet-approved
 * user, so they can complete sign-in and see a clear "access restricted"
 * state instead of a generic network error.
 *
 * NB: this middleware is mounted with `app.use("/api", requireDevAccess)`
 * (see app.ts), so Express strips the "/api" prefix before req.path reaches
 * here — these entries must NOT include it, or the allowlist silently never
 * matches and every listed route 401s instead of passing through.
 */
const DEV_ACCESS_ALLOWLIST = new Set([
  "/auth/provision",
  "/auth/me",
  "/healthz",
]);

/**
 * Extra app-level access gate for the dev.usegrowthforge.com environment,
 * on top of the network-level Caddy Basic Auth in front of that host.
 *
 * Only installed on the dev api-server process (`APP_ENV=development` — see
 * app.ts). Requires a verified Supabase session AND `users.canAccessDev`
 * (admin-approved) before any other `/api/*` route runs — this is what
 * satisfies "the development application must require authentication before
 * any content, features, dashboards, rendering tools, or platform
 * functionality can be accessed" at the API layer, not just the frontend.
 */
export async function requireDevAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (DEV_ACCESS_ALLOWLIST.has(req.path)) {
    next();
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in required to access the development environment." });
    return;
  }

  const [user] = await db.select({ canAccessDev: usersTable.canAccessDev }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user?.canAccessDev) {
    res.status(403).json({ error: "Your account has not been approved for dev environment access." });
    return;
  }

  next();
}
