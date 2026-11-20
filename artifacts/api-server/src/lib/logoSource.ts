import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * A logo burn writes its output under a recognisable key. Anything matching has
 * ALREADY had a badge composited onto it, so feeding it back through
 * compositeLogoOnVideo draws a second crest on top of the first - which is what
 * visually "disfigures" the logo when Apply-to-render is clicked more than once.
 */
export function isLogoBurnedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const decoded = url.toLowerCase();
  return decoded.includes("/logo/") || decoded.includes("-logo-");
}

/**
 * The render recorded BEFORE any badge was burned in, when the pipeline has one
 * on record. `runGrokRender` persists this via persistLogoMeta specifically so
 * the logo can always be re-applied from pristine footage instead of compounding.
 */
export async function getBrandingPreLogoUrl(videoId: number): Promise<string | null> {
  const [video] = await db.select({ cinematicPlan: videosTable.cinematicPlan }).from(videosTable)
    .where(eq(videosTable.id, videoId));
  if (!video?.cinematicPlan) return null;
  try {
    const plan = JSON.parse(video.cinematicPlan) as { branding?: { preLogoVideoUrl?: unknown } };
    const url = plan.branding?.preLogoVideoUrl;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Picks the source a logo may safely be composited onto, in priority order:
 * the earliest logo-free candidate offered by the caller, then the pipeline's
 * recorded pre-logo render. Returns pristine=false only when every candidate is
 * already badge-burned, which means re-burning would stack crests.
 */
export async function resolveLogoFreeSource(
  videoId: number,
  candidates: Array<string | null | undefined>,
): Promise<{ url: string | null; pristine: boolean }> {
  for (const candidate of candidates) {
    if (candidate && !isLogoBurnedUrl(candidate)) return { url: candidate, pristine: true };
  }
  const preLogo = await getBrandingPreLogoUrl(videoId);
  if (preLogo && !isLogoBurnedUrl(preLogo)) return { url: preLogo, pristine: true };
  return { url: candidates.find(Boolean) ?? null, pristine: false };
}
