import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Forces a real file download instead of the browser just opening/navigating
 * to the resource. The HTML `download` attribute on an <a> tag is silently
 * ignored by browsers for cross-origin URLs (e.g. Supabase Storage signed
 * URLs) — it only works for same-origin or `blob:` URLs. So we fetch the
 * resource ourselves, turn it into a same-origin blob: URL, and download that.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fall back to opening in a new tab so the user can still save it manually
    // (e.g. via right-click → Save As) if the fetch itself is blocked.
    window.open(url, "_blank", "noreferrer");
  }
}
