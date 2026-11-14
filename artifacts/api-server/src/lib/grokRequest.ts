import type { CommercialRenderJob } from "./commercialRenderer.js";

export const GROK_VIDEO_MODEL = "grok-imagine-video-1.5-lite";
export const GROK_VIDEO_ENDPOINT = "https://api.x.ai/v1/videos/generations";
export const GROK_VIDEO_STATUS_ENDPOINT = "https://api.x.ai/v1/videos";
export const GROK_NO_TEXT_INSTRUCTIONS =
  "Do not add unrequested captions, subtitles, text overlays, logos, or legible written text. Preserve and accurately render any customer-requested branding, logos, product labels, or approved on-screen text described in the brief or storyboard.";

export function grokBillableSeconds(requestedDuration: number | null | undefined, actualDuration?: number): number {
  const duration = actualDuration !== undefined && Number.isFinite(actualDuration)
    ? Math.ceil(actualDuration)
    : requestedDuration ?? 15;
  return Math.min(15, Math.max(1, duration));
}

export interface GrokGenerationRequest {
  model: typeof GROK_VIDEO_MODEL;
  prompt: string;
  duration: number;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  resolution: "720p";
  generate_audio: true;
}

/** xAI currently accepts 16:9, 9:16 and 1:1. 4:5 is made exact by our
 * post-generation frame normalization, starting from the closest portrait. */
export function grokSourceAspectRatio(aspectRatio: CommercialRenderJob["aspectRatio"]): GrokGenerationRequest["aspect_ratio"] {
  if (aspectRatio === "4:5") return "9:16";
  if (aspectRatio === "16:9" || aspectRatio === "9:16" || aspectRatio === "1:1") return aspectRatio;
  throw new Error(`Unsupported output aspect ratio: ${aspectRatio}`);
}

/**
 * Pure request builder; it performs no I/O and reads no credentials.
 */
export function buildGrokGenerationRequest(job: Pick<CommercialRenderJob,
  "script" | "storyboard" | "cinematicPlan" | "aspectRatio" | "durationSec"
>): GrokGenerationRequest {
  const plan = (() => {
    if (!job.cinematicPlan) return null;
    try { return JSON.parse(job.cinematicPlan) as { shots?: Array<{ duration?: number; environment?: string; subjectAction?: string; cameraMovement?: string; lighting?: string; dialogue?: string }> }; }
    catch { return null; }
  })();
  const shotText = plan?.shots?.map((shot, i) => {
    const parts = [shot.environment, shot.subjectAction, shot.cameraMovement, shot.lighting,
      shot.dialogue ? `Spoken dialogue: ${shot.dialogue}` : ""].filter(Boolean);
    return parts.length ? `Shot ${i + 1}: ${parts.join(". ")}` : "";
  }).filter(Boolean).join("\n");
  const content = [job.storyboard, shotText, job.script]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");
  if (!content.trim()) throw new Error("Grok generation requires a non-empty prompt");
  const prompt = `${content}\n\n${GROK_NO_TEXT_INSTRUCTIONS}`;

  const aspectRatio = grokSourceAspectRatio(job.aspectRatio);

  const duration = job.durationSec ?? 15;
  if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
    throw new Error("Grok video duration must be an integer from 1 to 15 seconds");
  }

  // Captions are intentionally not included: Grok audio is native and the
  // current approved integration must not add subtitles or text overlays.
  return {
    model: GROK_VIDEO_MODEL,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution: "720p",
    generate_audio: true,
  };
}
