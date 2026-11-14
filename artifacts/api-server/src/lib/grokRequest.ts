import type { CommercialRenderJob } from "./commercialRenderer.js";

export const GROK_VIDEO_MODEL = "grok-imagine-video-1.5-lite";
export const GROK_VIDEO_ENDPOINT = "https://api.x.ai/v1/videos/generations";

export interface GrokGenerationRequest {
  model: typeof GROK_VIDEO_MODEL;
  prompt: string;
  duration: number;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  resolution: "720p";
  generate_audio: true;
}

/**
 * Pure request builder for the Grok Imagine integration. It performs no I/O,
 * reads no credentials, and is deliberately not wired to the render pipeline.
 */
export function buildGrokGenerationRequest(job: Pick<CommercialRenderJob,
  "script" | "storyboard" | "cinematicPlan" | "aspectRatio" | "durationSec"
>): GrokGenerationRequest {
  const prompt = [job.storyboard, job.cinematicPlan, job.script]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");
  if (!prompt) throw new Error("Grok generation requires a non-empty prompt");

  const aspectRatio = job.aspectRatio;
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16" && aspectRatio !== "1:1") {
    throw new Error(`Grok does not support aspect ratio: ${aspectRatio}`);
  }

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
