import type { Request } from "express";

export type Region = "global" | "nigeria";

/**
 * Resolve the regional storefront from a validated hostname.
 * `ng.usegrowthforge.com` (or any `ng.*` host) → Nigeria; everything else → global.
 * The hostname is the single source of truth for the regional experience.
 */
export function resolveRegion(hostname: string | undefined | null): Region {
  const host = (hostname ?? "").trim().toLowerCase().split(":")[0];
  if (host === "ng.usegrowthforge.com" || host.startsWith("ng.")) return "nigeria";
  return "global";
}

/**
 * Resolve the region for an inbound request. Honors an `APP_REGION=nigeria`
 * override ONLY for isolated test environments where no `ng.*` DNS exists -
 * production never sets this and always resolves from the request host.
 */
export function getRegion(req: Request): Region {
  if (process.env.APP_REGION === "nigeria") return "nigeria";
  const fwd = req.headers["x-forwarded-host"];
  const host = Array.isArray(fwd) ? fwd[0] : (fwd ?? req.headers.host);
  return resolveRegion(typeof host === "string" ? host : undefined);
}
