/**
 * Canonical dev/prod hostnames for GrowthForge.
 *
 * Mirrors the pattern used for Quantivarian (`dev.quantivarian.com`):
 * `dev.usegrowthforge.com` is the internal-only environment where all
 * development, testing, and video-rendering work happens; `usegrowthforge.com`
 * / `www.usegrowthforge.com` is the public production domain.
 */
export const DEV_HOSTNAME = "dev.usegrowthforge.com";
export const PROD_HOSTNAMES = ["usegrowthforge.com", "www.usegrowthforge.com"];

/**
 * True for the non-public dev host. Used server-side to decide whether to
 * enforce the extra `canAccessDev` gate (see ../middlewares/devAccess.ts) on
 * top of the network-level Caddy Basic Auth in front of that host.
 */
export function isDevHost(host: string): boolean {
  const hostname = host.split(":")[0].toLowerCase();
  return hostname === DEV_HOSTNAME;
}
