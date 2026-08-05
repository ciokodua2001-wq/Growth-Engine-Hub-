import { useEffect } from "react";
import { createPortal } from "react-dom";
import { isDevHost } from "@/lib/domain-map";

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
 * purely cosmetic overlay.
 */
export function DevEnvironmentBanner() {
  const isDev = isDevHost();

  useEffect(() => {
    if (!isDev) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [isDev]);

  if (!isDev) return null;

  return createPortal(
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-black text-xs sm:text-sm font-semibold text-center py-1.5 px-4 tracking-wide shadow-md select-none"
    >
      DEVELOPMENT ENVIRONMENT — NOT FOR PUBLIC ACCESS
    </div>,
    document.body,
  );
}
