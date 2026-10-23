import type { Request } from "express";

export type Region = "global" | "nigeria";

/**
 * Resolve the regional storefront from a validated hostname.
 * ONLY the exact approved host `ng.usegrowthforge.com` maps to Nigeria.
 * (Previously matched any `ng.*` host - too broad.)
 */
export function resolveRegion(hostname: string | undefined | null): Region {
  const host = (hostname ?? "").trim().toLowerCase().split(":")[0];
  return host === "ng.usegrowthforge.com" ? "nigeria" : "global";
}

/**
 * Resolve the region for an inbound request.
 *
 * - `APP_REGION=nigeria` is a TEST-ONLY override, gated to non-production.
 *   It must never be set in production (production always resolves from the host).
 * - We resolve from the request `Host` header (authoritative - Caddy routes by
 *   Host), and deliberately DO NOT trust `X-Forwarded-Host`, which is
 *   client-controllable unless a trusted proxy overwrites it.
 */
export function getRegion(req: Request): Region {
  if (process.env.NODE_ENV !== "production" && process.env.APP_REGION === "nigeria") {
    return "nigeria";
  }
  return resolveRegion(req.get("host"));
}
