import { useEffect } from "react";
import { createPortal } from "react-dom";
import { isDevHost } from "@/lib/domain-map";

// Kept in sync with the banner's actual rendered height (py-1.5 + text line-height).
// Used to push page content down so the banner never overlaps headers or nav.
const BANNER_HEIGHT_PX = 28;

/**
 * Shown on every page when running on the non-public dev host
 * (dev.usegrowthforge.com) or the local Vite dev server. Also injects a
 * `noindex, nofollow` robots meta tag on these hosts as a client-side
 * backstop to the server-side X-Robots-Tag header (set by Caddy) and the
 * dev-only robots.txt override — belt-and-suspenders so search engines can
 * never index unfinished / IP-sensitive work.
 *
 * Rendered via a portal directly into document.body (outside the #root
 * tree) so it can never affect reconciliation of the main app tree — it's a
 * purely cosmetic overlay. Because it's `fixed`, it doesn't natively reserve
 * layout space, so we nudge the document down via a CSS variable + class on
 * <html> rather than editing every page's fixed/sticky header.
 */
export function DevEnvironmentBanner() {
  const isDev = isDevHost();

  useEffect(() => {
    if (!isDev) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);

    const root = document.documentElement;
    root.style.setProperty("--gf-dev-banner-height", `${BANNER_HEIGHT_PX}px`);
    root.classList.add("gf-dev-banner-active");

    return () => {
      document.head.removeChild(meta);
      root.classList.remove("gf-dev-banner-active");
      root.style.removeProperty("--gf-dev-banner-height");
    };
  }, [isDev]);

  if (!isDev) return null;

  return createPortal(
    <div
      role="status"
      style={{ height: BANNER_HEIGHT_PX }}
      className="gf-dev-banner fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-black text-xs sm:text-sm font-semibold text-center py-1.5 px-4 tracking-wide shadow-md select-none flex items-center justify-center"
    >
      DEVELOPMENT ENVIRONMENT — NOT FOR PUBLIC ACCESS
    </div>,
    document.body,
  );
}
