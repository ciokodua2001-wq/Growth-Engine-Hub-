/**
 * Client-side dev/prod hostname check for GrowthForge.
 * Must stay in sync with artifacts/api-server/src/config/domain-map.ts.
 *
 * Mirrors the pattern used for Quantivarian (`dev.quantivarian.com`):
 * `dev.usegrowthforge.com` is the internal-only environment where all
 * development, testing, and video-rendering work happens.
 */
const DEV_HOSTNAME = "dev.usegrowthforge.com";

/**
 * True when running on the non-public dev host, or the local Vite dev
 * server. Used to show the development banner and keep the host out of
 * search engines — never true for usegrowthforge.com. Access is gated by
 * Caddy HTTP Basic Auth only.
 */
export function isDevHost(): boolean {
  if (import.meta.env.DEV) return true;
  return window.location.hostname.toLowerCase() === DEV_HOSTNAME;
}
