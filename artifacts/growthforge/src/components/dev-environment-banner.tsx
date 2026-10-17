import { useEffect } from "react";
import { isDevHost } from "@/lib/domain-map";

/**
 * Injects a `noindex, nofollow` robots meta tag on dev hosts,
 * but renders NO visible banner element or layout offsets.
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

  return null;
}
