import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import pino from "pino";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";
import { extractLastFramePng } from "./wanFfmpeg.js";

const logger = pino({ name: "veoRenderer" });

// ── Google Veo 3.1 Lite — managed, native-audio video generation ────────────
// Chosen after a side-by-side production-brief comparison against Veo 3.1
// Fast and the existing Kling v2.6 pipeline (see
// .agents/memory/veo-lite-integration.md) as the best price/quality balance
// for talking-actor commercial footage. Uses the same GOOGLE_GENAI_API_KEY
// already configured for Gemini text/image generation — no new secret.
//
// HTTP contract (Gemini Developer API, verified against a working standalone
// test harness that generated 8 real comparison clips):
//   1. POST {BASE_URL}/models/{model}:predictLongRunning
//      { instances: [{ prompt, image?: { bytesBase64Encoded, mimeType } }],
//        parameters: { aspectRatio, durationSeconds, resolution } }
//      -> { name: "<operation name>" }
//   2. Poll GET {BASE_URL}/{operationName} until { done: true }.
//   3. response.generateVideoResponse.generatedSamples[0].video.uri holds the
//      downloadable clip (auth via the same x-goog-api-key header).
//
// Video and native audio (dialogue + ambience) arrive already muxed into one
// MP4 — no separate TTS/mixing step needed, same as Kling v2.6 native audio.

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const VEO_MODEL_ID = "veo-3.1-lite-generate-preview";

/** Veo 3.1 only accepts 4, 6, or 8 s. 8 s gives room for a full spoken line. */
export const VEO_SCENE_DURATION_SEC = 8;

const SUBMIT_MAX_ATTEMPTS = 5;
const POLL_MAX_ATTEMPTS = 90; // 90 × 10 s = 15 min per scene
const POLL_INTERVAL_MS = 10_000;

export interface VeoSceneRenderRequest {
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

export interface VeoSceneRenderResult {
  videoUrl: string;
  durationSec: number;
  providerTaskId?: string;
  /** Signed URL to the last frame of this clip — for the next scene's I2V continuity. */
  lastFrameUrl?: string;
}

export interface VeoRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkVeoRequirements(): VeoRequirementsResult {
  const missing: string[] = [];
  if (!process.env.GOOGLE_GENAI_API_KEY) missing.push("GOOGLE_GENAI_API_KEY");
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return { ready: missing.length === 0, missing };
}

/**
 * Veo 3.1 (all tiers, including Lite) only supports 16:9 and 9:16 — there is
 * no native square/1:1 mode. For a square-format request we render 9:16
 * (portrait) instead of 16:9: ffmpegAssembler's scale+pad step then letterboxes
 * left/right rather than top/bottom, which keeps a to-camera talking actor's
 * full height in frame — the far more common failure mode for this footage.
 */
function mapAspectRatioForVeo(aspectRatio: string): "16:9" | "9:16" {
  return aspectRatio === "16:9" ? "16:9" : "9:16";
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function apiKey(): string {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENAI_API_KEY environment variable is not configured");
  return key;
}

// ── Submit + poll ─────────────────────────────────────────────────────────────

interface VeoInstance {
  prompt: string;
  image?: { bytesBase64Encoded: string; mimeType: string };
}

async function startGeneration(instance: VeoInstance, aspectRatio: "16:9" | "9:16"): Promise<string> {
  const parameters = {
    aspectRatio,
    durationSeconds: VEO_SCENE_DURATION_SEC,
    resolution: "1080p",
  };

  for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE_URL}/models/${VEO_MODEL_ID}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ instances: [instance], parameters }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    if (res.ok) {
      const json = JSON.parse(text) as { name?: string };
      if (!json.name) throw new Error(`Veo predictLongRunning returned no operation name: ${text.slice(0, 500)}`);
      return json.name;
    }

    if (res.status === 429 && attempt < SUBMIT_MAX_ATTEMPTS) {
      const delay = 15_000 * attempt;
      logger.warn({ attempt, maxAttempts: SUBMIT_MAX_ATTEMPTS, delay }, "[VeoRenderer] 429 rate-limited — retrying");
      await sleep(delay);
      continue;
    }
    throw new Error(`Veo predictLongRunning HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  throw new Error("Veo predictLongRunning: exhausted retries");
}

interface VeoOperationResponse {
  generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
  generatedSamples?: Array<{ video?: { uri?: string } }>;
}

async function pollOperation(operationName: string): Promise<VeoOperationResponse> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${BASE_URL}/${operationName}`, {
      headers: { "x-goog-api-key": apiKey() },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn({ status: res.status, operationName, poll: i }, "[VeoRenderer] Poll request failed — retrying next interval");
      continue;
    }

    const json = JSON.parse(text) as { done?: boolean; error?: unknown; response?: VeoOperationResponse };
    if (json.error) {
      throw new Error(`Veo operation error: ${JSON.stringify(json.error).slice(0, 500)}`);
    }
    if (json.done) {
      if (!json.response) throw new Error("Veo operation completed with no response payload");
      return json.response;
    }
  }
  const timeoutMin = (POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 60_000;
  throw new Error(`Veo generation timed out after ${timeoutMin} min (operation=${operationName})`);
}

async function downloadToFile(uri: string, destPath: string): Promise<void> {
  const res = await fetch(uri, { headers: { "x-goog-api-key": apiKey() }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Veo video download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function fetchImageAsBase64(url: string): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Source frame fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytesBase64Encoded: buf.toString("base64"), mimeType: "image/png" };
}

// ── Storage ────────────────────────────────────────────────────────────────

async function storeSceneMp4(localMp4Path: string, videoId: number, sceneIndex: number): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const buffer = fs.readFileSync(localMp4Path);
  const objectName = `renders/veo/video-${videoId}-scene-${sceneIndex}.mp4`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(buffer, { metadata: { contentType: "video/mp4" } });

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14_400 });
}

async function storeLastFramePng(localPngPath: string, videoId: number, sceneIndex: number): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const buffer = fs.readFileSync(localPngPath);
  const objectName = `renders/veo/video-${videoId}-scene-${sceneIndex}-lastframe.png`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(buffer, { metadata: { contentType: "image/png" } });

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 86_400 });
}

// ── VeoRenderer ───────────────────────────────────────────────────────────────

export class VeoRenderer {
  isAvailable(): boolean {
    return checkVeoRequirements().ready;
  }

  async renderScene(req: VeoSceneRenderRequest): Promise<VeoSceneRenderResult> {
    if (!this.isAvailable()) {
      const { missing } = checkVeoRequirements();
      throw new Error(`Veo video provider is not configured (missing: ${missing.join(", ")})`);
    }
    if (!req.newSceneCut && !req.sourceFrameUrl) {
      throw new Error("Veo I2V (continuity) scene requires sourceFrameUrl but none was provided");
    }

    const aspectRatio = mapAspectRatioForVeo(req.aspectRatio);
    const instance: VeoInstance = { prompt: req.prompt };
    if (!req.newSceneCut) {
      instance.image = await fetchImageAsBase64(req.sourceFrameUrl!);
    }

    logger.info(
      { sceneJobId: req.sceneJobId, videoId: req.videoId, sceneIndex: req.sceneIndex, mode: req.newSceneCut ? "T2V" : "I2V", aspectRatio },
      "[VeoRenderer] Submitting to Veo 3.1 Lite",
    );

    const operationName = await startGeneration(instance, aspectRatio);
    logger.info({ sceneJobId: req.sceneJobId, operationName }, "[VeoRenderer] Operation started — polling");

    const response = await pollOperation(operationName);
    const samples = response.generateVideoResponse?.generatedSamples ?? response.generatedSamples;
    const uri = samples?.[0]?.video?.uri;
    if (!uri) {
      throw new Error(`Veo operation completed with no video URI: ${JSON.stringify(response).slice(0, 500)}`);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "veo-scene-"));
    try {
      const mp4Path = path.join(tmpDir, "scene.mp4");
      const framePath = path.join(tmpDir, "lastframe.png");

      logger.info({ sceneJobId: req.sceneJobId }, "[VeoRenderer] Downloading finished clip");
      await downloadToFile(uri, mp4Path);

      const videoUrl = await storeSceneMp4(mp4Path, req.videoId, req.sceneIndex);

      let lastFrameUrl: string | undefined;
      try {
        await extractLastFramePng(mp4Path, framePath);
        lastFrameUrl = await storeLastFramePng(framePath, req.videoId, req.sceneIndex);
      } catch (err) {
        // Non-fatal — only blocks a FUTURE continuity scene, not this one.
        logger.warn({ err, sceneJobId: req.sceneJobId }, "[VeoRenderer] Last-frame extraction failed (non-fatal)");
      }

      logger.info(
        { sceneJobId: req.sceneJobId, videoUrl, hasLastFrame: Boolean(lastFrameUrl) },
        "[VeoRenderer] Scene rendered and stored",
      );

      return {
        videoUrl,
        durationSec: VEO_SCENE_DURATION_SEC,
        providerTaskId: operationName,
        lastFrameUrl,
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

let _instance: VeoRenderer | null = null;
export function getVeoRenderer(): VeoRenderer {
  if (!_instance) _instance = new VeoRenderer();
  return _instance;
}
