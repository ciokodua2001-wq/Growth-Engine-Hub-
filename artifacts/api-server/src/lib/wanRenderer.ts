import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import pino from "pino";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";
import { transcodeWebmToMp4, extractLastFramePng } from "./wanFfmpeg.js";
import {
  buildWanT2VWorkflow,
  buildWanI2VWorkflow,
  computeWanDimensions,
  WAN_SAVE_NODE_ID,
  WAN_SCENE_DURATION_SEC,
  type WanWorkflow,
} from "./wanWorkflows.js";

const logger = pino({ name: "wanRenderer" });

// ── Self-hosted Wan 2.2 (14B, T2V-A14B + I2V-A14B) video worker, served via a ──
// Vast.ai Serverless endpoint (min_workers=0 / inactivity_timeout=300s — scales
// to zero between renders so idle time costs ~$0). Replaces Kling AI as the
// primary, low-cost video generation backend. Kling's code remains fully
// intact and reachable only via a deliberate, manual ACTIVE_VIDEO_PROVIDER
// flip during an extended Wan outage — see sceneManager.ts and
// .agents/memory/wan-vast-video-migration.md for the full design rationale.
//
// HTTP contract (verified against docs.vast.ai/guides/serverless/{overview,
// architecture,comfy-ui} + a proven third-party TS reference implementation):
//   1. POST https://run.vast.ai/route/ {endpoint, api_key, cost, request_idx,
//      replay_timeout} — poll until a worker `url` is returned (cold-start wake).
//   2. POST {workerUrl}/generate/sync {auth_data: <full route response>,
//      session_id: null, payload: {input: {request_id, workflow_json, s3}}}
//   3. Response.output[] contains a pre-signed S3 URL per generated asset (S3
//      config, pointed at our own Supabase Storage bucket via its S3-compatible
//      endpoint, is passed per-request below) — no local Vast.ai storage is
//      ever relied upon.

const VAST_ROUTE_URL = "https://run.vast.ai/route/";
const DEFAULT_REQUEST_COST = 6_000; // heavy relative to the SD1.5 benchmark baseline (100)
const DEFAULT_MAX_WAIT_SEC = 600; // 10 min — cold-start model load (≈60GB of fp8 weights) can be slow
const ROUTE_POLL_INTERVAL_MS = 10_000;
const WORKER_REQUEST_TIMEOUT_MS = 20 * 60_000; // /generate/sync blocks synchronously for the whole render

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
  /** Signed URL to the last frame of this clip — for the next scene's I2V continuity. */
  lastFrameUrl?: string;
}

export interface WanRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkWanRequirements(): WanRequirementsResult {
  const missing: string[] = [];
  if (!process.env.VAST_AI_API_KEY) missing.push("VAST_AI_API_KEY");
  if (!process.env.VAST_AI_ENDPOINT_ID) missing.push("VAST_AI_ENDPOINT_ID");
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_S3_ACCESS_KEY_ID) missing.push("SUPABASE_S3_ACCESS_KEY_ID");
  if (!process.env.SUPABASE_S3_SECRET_ACCESS_KEY) missing.push("SUPABASE_S3_SECRET_ACCESS_KEY");
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return { ready: missing.length === 0, missing };
}

// ── Vast.ai /route/ + worker HTTP contract types ─────────────────────────────

interface VastRouteResponse {
  url?: string;
  request_idx?: number;
  status?: unknown;
  error_msg?: string;
}

interface VastOutputAsset {
  filename: string;
  local_path?: string;
  url?: string; // pre-signed S3 URL — present only when S3 is configured
  type?: string;
  subfolder?: string;
  node_id?: string;
  output_type?: string;
}

interface VastGenerateSyncResponse {
  id?: string;
  status: "completed" | "failed" | "processing" | "generating" | "queued" | string;
  message?: string;
  comfyui_response?: unknown;
  output?: VastOutputAsset[];
  timings?: unknown;
}

// ── Supabase S3-compatible storage override (passed per-request so the ──────
// Vast.ai worker uploads generated clips directly into our own bucket).

function buildSupabaseS3Override(): { access_key_id: string; secret_access_key: string; endpoint_url: string; bucket_name: string; region: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!supabaseUrl || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "Wan S3 passthrough not configured (need SUPABASE_URL, SUPABASE_S3_ACCESS_KEY_ID, " +
        "SUPABASE_S3_SECRET_ACCESS_KEY, DEFAULT_OBJECT_STORAGE_BUCKET_ID)",
    );
  }
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return {
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    endpoint_url: `https://${projectRef}.storage.supabase.co/storage/v1/s3`,
    bucket_name: bucketName,
    region: process.env.SUPABASE_S3_REGION || "us-east-1",
  };
}

// ── Vast.ai Serverless resolve + submit ──────────────────────────────────────

interface ResolvedWorker {
  url: string;
  authData: VastRouteResponse;
}

async function resolveWorker(): Promise<ResolvedWorker> {
  const apiKey = process.env.VAST_AI_API_KEY;
  const endpoint = process.env.VAST_AI_ENDPOINT_ID;
  if (!apiKey || !endpoint) {
    throw new Error("VAST_AI_API_KEY / VAST_AI_ENDPOINT_ID not configured");
  }

  const cost = Number(process.env.VAST_AI_REQUEST_COST) || DEFAULT_REQUEST_COST;
  const maxWaitS = Number(process.env.VAST_AI_MAX_WAIT_SEC) || DEFAULT_MAX_WAIT_SEC;
  const t0 = Date.now();
  let requestIdx = 0;

  for (;;) {
    const res = await fetch(VAST_ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        endpoint,
        api_key: apiKey,
        cost,
        request_idx: requestIdx,
        replay_timeout: 60.0,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vast.ai route HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const route = (await res.json()) as VastRouteResponse;
    if (route.error_msg) {
      throw new Error(`Vast.ai route error: ${route.error_msg}`);
    }
    requestIdx = route.request_idx ?? requestIdx;
    if (route.url) {
      return { url: route.url.replace(/\/$/, ""), authData: route };
    }

    if ((Date.now() - t0) / 1000 >= maxWaitS) {
      const latestStatus = route.status === undefined ? "no status" : JSON.stringify(route.status).slice(0, 300);
      throw new Error(
        `Vast.ai: no worker became ready within ${maxWaitS}s (cold-start wake timeout). Latest status: ${latestStatus}`,
      );
    }

    logger.info({ elapsedMs: Date.now() - t0, maxWaitS }, "[WanRenderer] Waiting for Vast.ai worker to wake");
    await sleep(ROUTE_POLL_INTERVAL_MS);
  }
}

async function submitGenerateSync(
  worker: ResolvedWorker,
  workflow: WanWorkflow,
  requestId: string,
): Promise<VastGenerateSyncResponse> {
  const body = {
    auth_data: worker.authData,
    session_id: null,
    payload: {
      input: {
        request_id: requestId,
        workflow_json: workflow,
        s3: buildSupabaseS3Override(),
      },
    },
  };

  const res = await fetch(`${worker.url}/generate/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vast.ai worker HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  return (await res.json()) as VastGenerateSyncResponse;
}

// ── Asset handling: download raw WEBM → transcode → store in our bucket ─────

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Asset download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function storeSceneMp4(
  localMp4Path: string,
  videoId: number,
  sceneIndex: number,
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const buffer = fs.readFileSync(localMp4Path);
  const objectName = `renders/wan/video-${videoId}-scene-${sceneIndex}.mp4`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(buffer, {
    metadata: { contentType: "video/mp4" },
  });

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14_400 });
}

async function storeLastFramePng(
  localPngPath: string,
  videoId: number,
  sceneIndex: number,
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const buffer = fs.readFileSync(localPngPath);
  const objectName = `renders/wan/video-${videoId}-scene-${sceneIndex}-lastframe.png`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(buffer, {
    metadata: { contentType: "image/png" },
  });

  // 24h TTL — comfortably outlives the time between this scene finishing and
  // the next scene (if it's a continuity cut) being submitted.
  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 86_400 });
}

/**
 * Best-effort cleanup of the raw WEBM the PyWorker uploaded directly to our
 * bucket via the S3 override (we only keep the transcoded MP4 long-term).
 * Uses the exact key ComfyUI/PyWorker reported in the response — never
 * guesses a path — and never fails the render if cleanup itself fails.
 */
async function tryDeleteRawUpload(asset: VastOutputAsset): Promise<void> {
  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) return;
    const key = asset.subfolder ? `${asset.subfolder}/${asset.filename}` : asset.filename;
    const { supabaseAdmin } = await import("./supabaseClient.js");
    await supabaseAdmin.storage.from(bucketId).remove([key]);
  } catch (err) {
    logger.warn({ err, filename: asset.filename }, "[WanRenderer] Raw upload cleanup failed (non-fatal)");
  }
}

// ── WanRenderer ───────────────────────────────────────────────────────────────

export class WanRenderer {
  isAvailable(): boolean {
    return checkWanRequirements().ready;
  }

  async renderScene(req: WanSceneRenderRequest): Promise<WanSceneRenderResult> {
    if (!this.isAvailable()) {
      const { missing } = checkWanRequirements();
      throw new Error(`Wan video provider is not configured (missing: ${missing.join(", ")})`);
    }
    if (!req.newSceneCut && !req.sourceFrameUrl) {
      throw new Error("Wan I2V (continuity) scene requires sourceFrameUrl but none was provided");
    }

    const { width, height } = computeWanDimensions(req.aspectRatio);
    const workflow = req.newSceneCut
      ? buildWanT2VWorkflow({ positivePrompt: req.prompt, width, height })
      : buildWanI2VWorkflow({
          positivePrompt: req.prompt,
          width,
          height,
          sourceImageUrl: req.sourceFrameUrl!,
        });

    const requestId = `gf-v${req.videoId}-s${req.sceneIndex}-${randomUUID()}`;
    logger.info(
      { sceneJobId: req.sceneJobId, videoId: req.videoId, sceneIndex: req.sceneIndex, mode: req.newSceneCut ? "T2V" : "I2V", width, height, requestId },
      "[WanRenderer] Resolving Vast.ai worker",
    );

    const worker = await resolveWorker();
    logger.info(
      { sceneJobId: req.sceneJobId, workerUrl: worker.url },
      "[WanRenderer] Worker ready — submitting generate/sync",
    );

    const result = await submitGenerateSync(worker, workflow, requestId);
    if (result.status !== "completed") {
      throw new Error(`Vast.ai generation did not complete (status=${result.status}): ${result.message ?? "no message"}`);
    }

    const asset = result.output?.find(o => o.node_id === WAN_SAVE_NODE_ID) ?? result.output?.[0];
    if (!asset?.url) {
      throw new Error(
        "Vast.ai response had no S3 pre-signed URL for the generated clip — verify SUPABASE_S3_* env vars",
      );
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wan-scene-"));
    try {
      const webmPath = path.join(tmpDir, "scene.webm");
      const mp4Path = path.join(tmpDir, "scene.mp4");
      const framePath = path.join(tmpDir, "lastframe.png");

      logger.info({ sceneJobId: req.sceneJobId }, "[WanRenderer] Downloading raw clip from Supabase Storage");
      await downloadToFile(asset.url, webmPath);

      await transcodeWebmToMp4(webmPath, mp4Path);
      const videoUrl = await storeSceneMp4(mp4Path, req.videoId, req.sceneIndex);

      let lastFrameUrl: string | undefined;
      try {
        await extractLastFramePng(mp4Path, framePath);
        lastFrameUrl = await storeLastFramePng(framePath, req.videoId, req.sceneIndex);
      } catch (err) {
        // Non-fatal — only blocks a FUTURE continuity scene, not this one.
        logger.warn({ err, sceneJobId: req.sceneJobId }, "[WanRenderer] Last-frame extraction failed (non-fatal)");
      }

      logger.info(
        { sceneJobId: req.sceneJobId, videoUrl, hasLastFrame: Boolean(lastFrameUrl) },
        "[WanRenderer] Scene rendered, transcoded, and stored",
      );

      void tryDeleteRawUpload(asset);

      return {
        videoUrl,
        durationSec: WAN_SCENE_DURATION_SEC,
        providerTaskId: result.id,
        lastFrameUrl,
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

let _instance: WanRenderer | null = null;
export function getWanRenderer(): WanRenderer {
  if (!_instance) _instance = new WanRenderer();
  return _instance;
}
