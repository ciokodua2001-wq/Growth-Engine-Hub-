import pino from "pino";

const logger = pino({ name: "wanRenderer" });

// ── Wan 2.7 (14B) self-hosted video worker, served via a Vast.ai serverless ──
// endpoint (min_workers=0 / scale_down_delay=300s — scales to zero between
// renders so idle time costs ~$0). Replaces Kling AI 2.5 as the primary,
// low-cost video generation backend; Kling remains wired in as an automatic
// fallback (see sceneManager.ts) if this provider errors or is unconfigured.

export interface WanSceneRenderRequest {
  sceneJobId: number;
  videoId: number;
  sceneIndex: number;
  prompt: string;
  aspectRatio: string;
  durationSec: number;
  /** true = new scene cut → text-to-video (T2V). false = continuity → image-to-video (I2V). */
  newSceneCut: boolean;
  /** Required when newSceneCut is false — the last frame of the previous scene's clip. */
  sourceFrameUrl?: string | null;
}

export interface WanSceneRenderResult {
  videoUrl: string;
  durationSec: number;
  providerTaskId?: string;
}

export interface WanRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkWanRequirements(): WanRequirementsResult {
  const missing: string[] = [];
  if (!process.env.VAST_AI_API_KEY) missing.push("VAST_AI_API_KEY");
  if (!process.env.VAST_AI_ENDPOINT_ID) missing.push("VAST_AI_ENDPOINT_ID");
  return { ready: missing.length === 0, missing };
}

/**
 * STATUS: scaffolding only. `renderScene()` intentionally throws below —
 * the actual Vast.ai PyWorker HTTP contract, the Wan 2.7 worker container,
 * and the serverless endpoint itself are separate, still-pending build
 * steps (see .agents/memory/wan-vast-video-migration.md).
 *
 * This class exists now so the provider abstraction + ACTIVE_VIDEO_PROVIDER
 * feature flag can be wired end-to-end today. With ACTIVE_VIDEO_PROVIDER=wan,
 * Wan is the EXCLUSIVE renderer for new scenes — sceneManager.ts does NOT
 * automatically fall back to Kling when this throws. A thrown error here
 * results in a visibly "failed" scene, by design, so a Wan outage is never
 * silently masked. Kling remains available only as a manual, operator-chosen
 * switch (flip ACTIVE_VIDEO_PROVIDER back to "kling") during an extended
 * Wan outage — never an automatic per-scene fallback.
 */
export class WanRenderer {
  isAvailable(): boolean {
    return checkWanRequirements().ready;
  }

  async renderScene(req: WanSceneRenderRequest): Promise<WanSceneRenderResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "Wan video provider is not configured (missing VAST_AI_API_KEY and/or VAST_AI_ENDPOINT_ID)",
      );
    }

    logger.warn(
      { sceneJobId: req.sceneJobId, videoId: req.videoId, sceneIndex: req.sceneIndex },
      "[WanRenderer] renderScene called but not yet implemented — Vast.ai worker/endpoint pending",
    );

    // TODO(wan_client): POST to the Vast.ai serverless endpoint's PyWorker
    // route with a T2V request (req.newSceneCut = true) or an I2V request
    // (req.newSceneCut = false, using req.sourceFrameUrl as the starting
    // frame), then poll/await the async job, download the resulting clip,
    // and upload it to object storage the same way Kling scenes are stored.
    throw new Error(
      "WanRenderer.renderScene is not yet implemented — the Vast.ai worker container " +
        "and serverless endpoint have not been provisioned yet. See " +
        ".agents/memory/wan-vast-video-migration.md for status.",
    );
  }
}

let _instance: WanRenderer | null = null;
export function getWanRenderer(): WanRenderer {
  if (!_instance) _instance = new WanRenderer();
  return _instance;
}
