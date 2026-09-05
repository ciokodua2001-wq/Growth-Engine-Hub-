import type { Request } from "express";

/**
 * Public origin of the request (scheme + host), used for OAuth redirect URIs.
 * Prefer PUBLIC_APP_URL when set; otherwise derive from forwarded headers
 * so Lightsail/Caddy (dev.usegrowthforge.com vs usegrowthforge.com) is correct.
 */
export function appOrigin(req: Request): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const proto = (req.get("x-forwarded-proto") ?? req.protocol ?? "https")
    .split(",")[0]
    .trim();
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "usegrowthforge.com")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

export function oauthRedirectUri(req: Request, path: string, envKey?: string): string {
  const fromEnv = envKey ? process.env[envKey]?.trim().replace(/\/$/, "") : "";
  if (fromEnv) return fromEnv;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${appOrigin(req)}${normalized}`;
}
