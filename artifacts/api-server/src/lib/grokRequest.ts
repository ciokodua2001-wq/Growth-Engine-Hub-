import type { CommercialRenderJob } from "./commercialRenderer.js";

export const GROK_VIDEO_MODEL = "grok-imagine-video-1.5-lite";
export const GROK_VIDEO_ENDPOINT = "https://api.x.ai/v1/videos/generations";
export const GROK_VIDEO_STATUS_ENDPOINT = "https://api.x.ai/v1/videos";
export const GROK_NO_TEXT_INSTRUCTIONS =
  "Generate one full-frame, single continuous cinematic shot. Never create split-screen, divided panels, triptychs, grids, contact sheets, storyboards, picture-in-picture, or multiple simultaneous views. The opening frame must be a normal full-frame cinematic image, not a collage or montage. Do not invent, approximate, synthesize, or display any logo, brand mark, watermark, product label, caption, subtitle, text overlay, or legible written text. Branding will only be composited from an explicitly uploaded transparent logo asset after generation. Any computer monitors, laptop screens, phones, dashboards, or software interfaces visible in frame must be rendered out of focus with only soft light and color gradients, or shown at a steep angle where no content is readable; never render legible or invented text, letters, numbers, or UI labels on any screen surface.";

export function grokBillableSeconds(requestedDuration: number | null | undefined, actualDuration?: number): number {
  const duration = actualDuration !== undefined && Number.isFinite(actualDuration)
    ? Math.ceil(actualDuration)
    : requestedDuration ?? 15;
  return Math.min(60, Math.max(1, duration));
}

export interface GrokGenerationRequest {
  model: typeof GROK_VIDEO_MODEL;
  prompt: string;
  duration: number;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  resolution: "720p";
  generate_audio: false;
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
  "script" | "storyboard" | "cinematicPlan" | "aspectRatio" | "durationSec" | "totalDurationSec" | "segmentStartSec" | "segmentIndex" | "segmentCount"
>): GrokGenerationRequest {
  const plan = (() => {
    if (!job.cinematicPlan) return null;
    try { return JSON.parse(job.cinematicPlan) as {
      visualStyle?: string; characterDescription?: string; environment?: string; lighting?: string;
      cameraLanguage?: string; performanceDirection?: string; textOverlayPlacement?: string; finalHeroShot?: string;
      shots?: Array<{ duration?: number; environment?: string; subjectAction?: string; facialExpression?: string; bodyMovement?: string; cameraMovement?: string; lensStyle?: string; lighting?: string; visualEffects?: string; transition?: string; dialogue?: string }>;
    }; }
    catch { return null; }
  })();
  const briefText = plan ? [
    ["Visual style", plan.visualStyle], ["Character", plan.characterDescription],
    ["Overall environment", plan.environment], ["Overall lighting", plan.lighting],
    ["Camera language", plan.cameraLanguage], ["Performance direction", plan.performanceDirection],
    ["Text overlay placement", plan.textOverlayPlacement], ["Final hero shot", plan.finalHeroShot],
  ].filter(([, value]) => typeof value === "string" && value.trim()).map(([label, value]) => `${label}: ${value}`).join("\n") : "";
  const segmentStartSec = job.segmentStartSec ?? 0;
  const segmentEndSec = segmentStartSec + (job.durationSec ?? 15);
  const shots = plan?.shots ?? [];
  const rawShotDuration = shots.reduce((sum, shot) => sum + (Number.isFinite(shot.duration) && shot.duration! > 0 ? shot.duration! : 0), 0);
  const scale = rawShotDuration > 0 && job.totalDurationSec ? job.totalDurationSec / rawShotDuration : 1;
  let shotCursor = 0;
  const shotText = plan?.shots?.map((shot, i) => {
    const shotDuration = (Number.isFinite(shot.duration) && shot.duration! > 0 ? shot.duration! : 5) * scale;
    const shotStart = shotCursor;
    const shotEnd = shotStart + shotDuration;
    shotCursor = shotEnd;
    if (shotEnd <= segmentStartSec || shotStart >= segmentEndSec) return "";
    const parts = [
      ["Duration", shot.duration ? `${shot.duration} seconds` : ""], ["Environment", shot.environment],
      ["Subject action", shot.subjectAction],
      ["Facial expression", shot.facialExpression], ["Body movement", shot.bodyMovement],
      ["Camera movement", shot.cameraMovement], ["Lens", shot.lensStyle], ["Lighting", shot.lighting],
      ["Visual effects", shot.visualEffects], ["Transition", shot.transition],
    ].filter(([, value]) => typeof value === "string" && value.trim()).map(([label, value]) => `${label}: ${value}`);
    return parts.length ? `Shot ${i + 1}\n${parts.join("\n")}` : "";
  }).filter(Boolean).join("\n");
  const visualFallback = shots.length ? "" : job.storyboard || job.script;
  const segmentLabel = job.segmentCount ? `Clip ${job.segmentIndex ?? 1} of ${job.segmentCount}, covering seconds ${segmentStartSec}-${segmentEndSec} of one continuous ${job.totalDurationSec ?? segmentEndSec}-second commercial.` : "";
  const content = [briefText, visualFallback, shotText, segmentLabel]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");
  if (!content.trim()) throw new Error("Grok generation requires a non-empty prompt");
  const prompt = `${content}\n\nVisual-only instruction: This is silent picture footage. Actors must not speak, mouth words, or produce dialogue. No music or sound effects. Dialogue will be added separately as controlled English narration. Each shot description is a separate sequential moment in one video, never simultaneous panels.\n\n${GROK_NO_TEXT_INSTRUCTIONS}`;

  const aspectRatio = grokSourceAspectRatio(job.aspectRatio);

  const duration = job.durationSec ?? 15;
  if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
    throw new Error("Grok video duration must be an integer from 1 to 15 seconds");
  }

  // Grok audio is disabled so only reviewed script text is spoken by TTS.
  return {
    model: GROK_VIDEO_MODEL,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution: "720p",
    generate_audio: false,
  };
}
