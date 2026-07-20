export type CommercialRenderStatus = "idle" | "queued" | "processing" | "complete" | "failed";
export type CommercialResolution = "1080p" | "4k";
export type CommercialAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export interface CommercialRenderJob {
  videoId: number;
  resolution: CommercialResolution;
  aspectRatio: CommercialAspectRatio;
  captionsEnabled: boolean;
  script: string;
  storyboard?: string | null;
  cinematicPlan?: string | null;
  voiceoverUrl?: string | null;
  durationSec?: number;
}

export interface CommercialRenderResult {
  videoUrl: string;
  durationSec?: number;
  sceneUrls?: string[];
  sceneJobIds?: number[];
}

export interface CommercialRendererCapabilities {
  supportsVoiceover: boolean;
  supportsFootage: boolean;
  supportsCaptions: boolean;
  maxResolution: CommercialResolution;
}

export interface CommercialRenderer {
  readonly name: string;
  readonly description: string;
  readonly capabilities: CommercialRendererCapabilities;
  isAvailable(): boolean;
  render(job: CommercialRenderJob): Promise<CommercialRenderResult>;
}
