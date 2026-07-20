import pino from "pino";
import { db } from "@workspace/db";
import { klingSceneJobsTable, videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type {
  CommercialRenderer,
  CommercialRenderJob,
  CommercialRenderResult,
  CommercialRendererCapabilities,
} from "./commercialRenderer.js";

const logger = pino({ name: "klingRenderer" });

// ── Official Kling Developer API ───────────────────────────────────────────────
// Docs: https://kling.ai/document-api
// Non-China base URL (for servers outside mainland China)
const KLING_BASE_URL = "https://api-singapore.klingai.com";
const KLING_DEFAULT_MODEL = "kling-v2-5-turbo";
const KLING_SCENE_DURATION_STR = "5";   // "5" or "10" — string per API spec
const KLING_SCENE_DURATION_SEC = 5;
const KLING_MODE = "std";               // "std" or "pro"
const KLING_SOUND = "off";              // we handle audio separately
const KLING_MAX_POLLS = 120;            // 120 × 10s = 20 min max per scene
const KLING_POLL_INTERVAL_MS = 10_000;
const KLING_SCENE_BATCH_SIZE = 3;       // parallel submissions per batch
const KLING_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, ugly, pixelated, amateur, watermark, text overlay";

// ── API contract types ────────────────────────────────────────────────────────

interface KlingT2VRequest {
  model_name: string;
  prompt: string;
  negative_prompt?: string;
  duration: string;
  mode: string;
  aspect_ratio: string;
  sound?: string;
  external_task_id?: string;
}

interface KlingVideoResult {
  id: string;
  url: string;
  duration: string;
}

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg?: string;
  created_at: number;
  updated_at: number;
  task_result?: {
    videos?: KlingVideoResult[];
  };
}

interface KlingApiResponse {
  code: number;
  message: string;
  request_id?: string;
  data: KlingTaskData;
}

// ── Extended render result type ───────────────────────────────────────────────

export interface KlingRenderResult extends CommercialRenderResult {
  sceneUrls: string[];
  sceneJobIds: number[];
}

// ── Cinematic plan types (mirror videoRenderPipeline structure) ───────────────

interface CinematicShot {
  shotNumber: number;
  duration: number;
  environment: string;
  subjectAction: string;
  facialExpression: string;
  bodyMovement: string;
  cameraMovement: string;
  lensStyle: string;
  lighting: string;
  visualEffects: string;
  transition: string;
  dialogue?: string;
}

interface CinematicPlan {
  visualStyle: string;
  characterDescription: string;
  environment: string;
  lighting: string;
  cameraLanguage: string;
  performanceDirection: string;
  shots: CinematicShot[];
}

// ── Blueprint → Scene prompt conversion ──────────────────────────────────────
// Converts the Commercial Blueprint (storyboard + cinematicPlan) into an array
// of per-scene Kling prompts. Mirrors the logic in videoRenderPipeline.ts so
// scene quality is identical regardless of which renderer is used.

function parseCinematicPlan(json: string | null | undefined): CinematicPlan | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as CinematicPlan;
  } catch {
    return null;
  }
}

function buildScenePrompts(
  title: string,
  storyboard: string,
  count: number,
  cinematicPlan?: string | null,
): string[] {
  const plan = parseCinematicPlan(cinematicPlan);

  if (plan?.shots?.length) {
    const stylePrefix = plan.visualStyle
      ? `${plan.visualStyle}. Photorealistic, cinema-grade, Hollywood-quality. `
      : "Photorealistic, cinema-grade, Hollywood-quality. ";

    return Array.from({ length: count }, (_, i) => {
      const shot = plan.shots[i % plan.shots.length]!;
      const parts = [
        stylePrefix,
        shot.environment ? `Location: ${shot.environment}.` : "",
        shot.subjectAction ? `Action: ${shot.subjectAction}.` : "",
        shot.cameraMovement ? `Camera: ${shot.cameraMovement}.` : "",
        shot.lensStyle ? `Lens: ${shot.lensStyle}.` : "",
        shot.lighting ? `Lighting: ${shot.lighting}.` : "",
        shot.visualEffects && !["none", "n/a"].includes(shot.visualEffects.toLowerCase())
          ? `Effects: ${shot.visualEffects}.`
          : "",
        "Natural motion, shallow depth of field, professional color grading.",
      ]
        .filter(Boolean)
        .join(" ");
      return parts.slice(0, 500);
    });
  }

  // Fallback: line-by-line storyboard parsing
  const scenes = storyboard
    .split("\n")
    .map(l => l.replace(/^scene\s*\d+[:.]\s*/i, "").trim())
    .filter(l => l.length > 5);

  const base = scenes.length > 0 ? scenes : [`Marketing video for: ${title}`];
  return Array.from({ length: count }, (_, i) => {
    const scene = base[i % base.length] ?? title;
    return `Cinematic marketing footage, professional grade, 4K quality. ${scene.slice(0, 400)}`;
  });
}

// ── KlingCommercialRenderer ───────────────────────────────────────────────────

export class KlingCommercialRenderer implements CommercialRenderer {
  readonly name = "KlingCommercialRenderer";
  readonly description =
    "Official Kling AI Developer API — generates cinematic scenes from Commercial Blueprints";
  readonly capabilities: CommercialRendererCapabilities = {
    supportsVoiceover: false,
    supportsFootage: true,
    supportsCaptions: false,
    maxResolution: "1080p",
  };

  private get apiKey(): string {
    const key = process.env.KLING_API_KEY;
    if (!key) throw new Error("KLING_API_KEY environment variable is not configured");
    return key;
  }

  isAvailable(): boolean {
    return Boolean(process.env.KLING_API_KEY && process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
  }

  // ── render() — main entry point ──────────────────────────────────────────────
  // Accepts a CommercialRenderJob (the Blueprint), generates all scenes via the
  // official Kling API, downloads + stores each completed scene, and returns
  // a KlingRenderResult with per-scene URLs and DB record IDs.
  //
  // FFmpeg composition is NOT performed here — caller handles assembly.

  async render(job: CommercialRenderJob): Promise<KlingRenderResult> {
    const { videoId, aspectRatio, durationSec = 60, storyboard, cinematicPlan } = job;

    logger.info({ videoId, durationSec, aspectRatio }, "[KlingRenderer] Starting commercial render");

    const video = await this.loadVideo(videoId);
    const title = video?.title ?? `Video ${videoId}`;

    const numScenes = Math.max(1, Math.ceil(durationSec / KLING_SCENE_DURATION_SEC));
    const klingAspectRatio = this.normaliseAspectRatio(aspectRatio);
    const prompts = buildScenePrompts(title, storyboard ?? "", numScenes, cinematicPlan);

    logger.info(
      { videoId, numScenes, klingAspectRatio, model: KLING_DEFAULT_MODEL },
      "[KlingRenderer] Blueprint parsed — scene prompts built",
    );

    // Persist all scene jobs to DB before any API calls
    const sceneJobIds = await this.createSceneJobs(videoId, prompts, klingAspectRatio);
    logger.info({ videoId, sceneJobIds }, "[KlingRenderer] Scene job records created in DB");

    // Submit scenes to Kling in controlled batches (avoid rate-limit bursts)
    const klingTaskIds = await this.submitSceneBatches(
      sceneJobIds,
      prompts,
      klingAspectRatio,
      videoId,
    );
    logger.info({ videoId, klingTaskIds }, "[KlingRenderer] All scenes submitted to Kling API");

    // Poll all scenes concurrently until each resolves (succeed | failed | timeout)
    const sceneUrls = await this.pollAllScenes(sceneJobIds, klingTaskIds, videoId);
    logger.info(
      { videoId, successfulScenes: sceneUrls.length },
      "[KlingRenderer] Scene generation complete",
    );

    return {
      videoUrl: sceneUrls[0] ?? "",
      durationSec,
      sceneUrls,
      sceneJobIds,
    };
  }

  // ── DB helpers ────────────────────────────────────────────────────────────

  private async loadVideo(videoId: number) {
    const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
    return video ?? null;
  }

  private async createSceneJobs(
    videoId: number,
    prompts: string[],
    aspectRatio: string,
  ): Promise<number[]> {
    const rows = await db
      .insert(klingSceneJobsTable)
      .values(
        prompts.map((prompt, i) => ({
          videoId,
          sceneIndex: i,
          prompt,
          status: "pending" as const,
          model: KLING_DEFAULT_MODEL,
          aspectRatio,
        })),
      )
      .returning({ id: klingSceneJobsTable.id });

    return rows.map(r => r.id);
  }

  // ── Scene submission ──────────────────────────────────────────────────────

  // Submits scenes in batches of KLING_SCENE_BATCH_SIZE (concurrent within
  // each batch, sequential between batches). Returns ordered klingTaskIds array;
  // null at a position means that scene failed to submit and was marked failed in DB.
  private async submitSceneBatches(
    sceneJobIds: number[],
    prompts: string[],
    aspectRatio: string,
    videoId: number,
  ): Promise<Array<string | null>> {
    const results: Array<string | null> = new Array(sceneJobIds.length).fill(null);

    for (let i = 0; i < sceneJobIds.length; i += KLING_SCENE_BATCH_SIZE) {
      const batchEnd = Math.min(i + KLING_SCENE_BATCH_SIZE, sceneJobIds.length);
      const batchIndices = Array.from({ length: batchEnd - i }, (_, k) => i + k);

      logger.info(
        { videoId, batchStart: i, batchSize: batchIndices.length, totalScenes: sceneJobIds.length },
        "[KlingRenderer] Submitting scene batch",
      );

      await Promise.all(
        batchIndices.map(async idx => {
          const jobId = sceneJobIds[idx]!;
          const prompt = prompts[idx]!;
          const externalTaskId = `gf-v${videoId}-s${idx}-${Date.now()}`;

          try {
            const taskId = await this.submitKlingScene(prompt, aspectRatio, externalTaskId);

            await db
              .update(klingSceneJobsTable)
              .set({ klingTaskId: taskId, externalTaskId, status: "submitted", updatedAt: new Date() })
              .where(eq(klingSceneJobsTable.id, jobId));

            results[idx] = taskId;
            logger.info(
              { videoId, sceneIndex: idx, klingTaskId: taskId, externalTaskId },
              "[KlingRenderer] Scene submitted to Kling — task created",
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(
              { err, videoId, sceneIndex: idx, jobId },
              "[KlingRenderer] Scene submission failed — marking failed in DB",
            );
            await db
              .update(klingSceneJobsTable)
              .set({ status: "failed", errorMessage: `Submission failed: ${msg}`, updatedAt: new Date() })
              .where(eq(klingSceneJobsTable.id, jobId));
          }
        }),
      );
    }

    return results;
  }

  // Single Kling T2V submission — POST /v1/videos/text2video
  // Returns the Kling task_id on success.
  private async submitKlingScene(
    prompt: string,
    aspectRatio: string,
    externalTaskId: string,
  ): Promise<string> {
    const body: KlingT2VRequest = {
      model_name: KLING_DEFAULT_MODEL,
      prompt,
      negative_prompt: KLING_NEGATIVE_PROMPT,
      duration: KLING_SCENE_DURATION_STR,
      mode: KLING_MODE,
      aspect_ratio: aspectRatio,
      sound: KLING_SOUND,
      external_task_id: externalTaskId,
    };

    logger.debug(
      { externalTaskId, aspectRatio, promptLen: prompt.length },
      "[KlingRenderer] Submitting T2V request to Kling API",
    );

    return withRetry(async () => {
      const res = await fetch(`${KLING_BASE_URL}/v1/videos/text2video`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kling submit HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const json = (await res.json()) as KlingApiResponse;
      if (json.code !== 0) {
        throw new Error(`Kling submit error (code=${json.code}): ${json.message}`);
      }

      logger.debug(
        { klingTaskId: json.data.task_id, requestId: json.request_id },
        "[KlingRenderer] Kling task created",
      );
      return json.data.task_id;
    });
  }

  // ── Scene polling ─────────────────────────────────────────────────────────

  // Polls all submitted scenes concurrently. Each scene is polled independently
  // so a slow scene does not block a fast one.
  private async pollAllScenes(
    sceneJobIds: number[],
    klingTaskIds: Array<string | null>,
    videoId: number,
  ): Promise<string[]> {
    const sceneUrls: string[] = [];

    const settled = await Promise.allSettled(
      sceneJobIds.map(async (jobId, idx) => {
        const taskId = klingTaskIds[idx];
        if (!taskId) {
          logger.warn(
            { videoId, sceneIndex: idx },
            "[KlingRenderer] Skipping poll — scene failed at submission",
          );
          return null;
        }
        return this.pollScene(jobId, idx, taskId, videoId);
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        sceneUrls.push(result.value);
      }
    }

    if (sceneUrls.length === 0) {
      throw new Error(
        "All Kling scenes failed to render. Check logs for per-scene error details.",
      );
    }

    logger.info(
      { videoId, total: sceneJobIds.length, successful: sceneUrls.length },
      "[KlingRenderer] Scene polling complete",
    );
    return sceneUrls;
  }

  // Polls a single scene until it reaches a terminal state.
  // Updates DB at each status transition.
  private async pollScene(
    jobId: number,
    sceneIndex: number,
    klingTaskId: string,
    videoId: number,
  ): Promise<string> {
    logger.info(
      { videoId, sceneIndex, klingTaskId },
      "[KlingRenderer] Starting scene poll loop",
    );

    for (let poll = 0; poll < KLING_MAX_POLLS; poll++) {
      await sleep(KLING_POLL_INTERVAL_MS);

      let taskData: KlingTaskData;
      try {
        taskData = await withRetry(async () => {
          const res = await fetch(
            `${KLING_BASE_URL}/v1/videos/text2video/${klingTaskId}`,
            {
              headers: { Authorization: `Bearer ${this.apiKey}` },
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Kling poll HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
          const json = (await res.json()) as KlingApiResponse;
          if (json.code !== 0) {
            throw new Error(`Kling poll error (code=${json.code}): ${json.message}`);
          }
          return json.data;
        });
      } catch (err) {
        // Individual poll failures are non-fatal — log and continue polling
        logger.warn(
          { err, videoId, sceneIndex, klingTaskId, poll },
          "[KlingRenderer] Poll request failed — will retry next interval",
        );
        continue;
      }

      logger.debug(
        { videoId, sceneIndex, klingTaskId, poll, status: taskData.task_status },
        "[KlingRenderer] Poll tick",
      );

      // Update DB on status transitions
      if (taskData.task_status === "processing") {
        await db
          .update(klingSceneJobsTable)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(klingSceneJobsTable.id, jobId));
      }

      if (taskData.task_status === "succeed") {
        const remoteUrl = taskData.task_result?.videos?.[0]?.url;
        if (!remoteUrl) {
          const msg = `Kling scene ${klingTaskId} succeed status but returned no video URL`;
          logger.error({ videoId, sceneIndex, klingTaskId, taskData }, `[KlingRenderer] ${msg}`);
          await db
            .update(klingSceneJobsTable)
            .set({ status: "failed", errorMessage: msg, updatedAt: new Date() })
            .where(eq(klingSceneJobsTable.id, jobId));
          throw new Error(msg);
        }

        logger.info(
          { videoId, sceneIndex, klingTaskId, remoteUrl },
          "[KlingRenderer] Scene complete — downloading from Kling CDN",
        );

        const storedUrl = await this.downloadAndStore(remoteUrl, videoId, sceneIndex);

        await db
          .update(klingSceneJobsTable)
          .set({
            status: "succeed",
            videoUrl: storedUrl,
            durationSec: KLING_SCENE_DURATION_SEC,
            updatedAt: new Date(),
          })
          .where(eq(klingSceneJobsTable.id, jobId));

        logger.info(
          { videoId, sceneIndex, klingTaskId, storedUrl },
          "[KlingRenderer] Scene downloaded and stored in object storage",
        );
        return storedUrl;
      }

      if (taskData.task_status === "failed") {
        const msg =
          taskData.task_status_msg ?? `Kling generation failed for task ${klingTaskId}`;
        logger.error(
          { videoId, sceneIndex, klingTaskId, msg },
          "[KlingRenderer] Kling reported scene generation failure",
        );
        await db
          .update(klingSceneJobsTable)
          .set({ status: "failed", errorMessage: msg, updatedAt: new Date() })
          .where(eq(klingSceneJobsTable.id, jobId));
        throw new Error(`Kling scene failed: ${msg}`);
      }
    }

    const timeoutMin = (KLING_MAX_POLLS * KLING_POLL_INTERVAL_MS) / 60_000;
    const timeoutMsg = `Scene polling timed out after ${timeoutMin} minutes (task=${klingTaskId})`;
    logger.error(
      { videoId, sceneIndex, klingTaskId, maxPolls: KLING_MAX_POLLS },
      `[KlingRenderer] ${timeoutMsg}`,
    );
    await db
      .update(klingSceneJobsTable)
      .set({ status: "failed", errorMessage: timeoutMsg, updatedAt: new Date() })
      .where(eq(klingSceneJobsTable.id, jobId));
    throw new Error(timeoutMsg);
  }

  // ── Asset download + storage ──────────────────────────────────────────────

  private async downloadAndStore(
    remoteUrl: string,
    videoId: number,
    sceneIndex: number,
  ): Promise<string> {
    const res = await withRetry(async () => {
      const r = await fetch(remoteUrl, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`Scene download HTTP ${r.status}`);
      return r;
    });

    const buffer = Buffer.from(await res.arrayBuffer());
    logger.info(
      { videoId, sceneIndex, bytes: buffer.length },
      "[KlingRenderer] Scene downloaded — uploading to object storage",
    );

    return uploadSceneToStorage(buffer, videoId, sceneIndex);
  }

  // ── Aspect ratio normalisation ────────────────────────────────────────────

  // Kling supports: "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"
  // "4:5" is Instagram-specific — map to closest Kling-supported ratio
  private normaliseAspectRatio(ar: string): string {
    if (ar === "4:5") return "9:16";
    return ar;
  }
}

// ── Storage helper ────────────────────────────────────────────────────────────

async function uploadSceneToStorage(
  buffer: Buffer,
  videoId: number,
  sceneIndex: number,
): Promise<string> {
  const { objectStorageClient, signObjectURL } = await import("./objectStorage.js");
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const bucket = objectStorageClient.bucket(bucketId);
  const objectName = `renders/kling/video-${videoId}-scene-${sceneIndex}-${Date.now()}.mp4`;
  const file = bucket.file(objectName);

  await file.save(buffer, { metadata: { contentType: "video/mp4" } });

  // 4-hour signed URL — scenes are consumed by FFmpeg composition in this window
  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14_400 });
}

// ── Generic helpers ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 2_000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500;
      logger.warn(
        { attempt, maxAttempts, nextRetryMs: Math.round(delay) },
        "[KlingRenderer] Transient error — retrying with backoff",
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|502|503|504|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(msg);
}

// ── Availability check (used by render route) ─────────────────────────────────

export interface KlingRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkKlingRequirements(): KlingRequirementsResult {
  const missing: string[] = [];
  if (!process.env.KLING_API_KEY) missing.push("KLING_API_KEY");
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return { ready: missing.length === 0, missing };
}

// ── Singleton factory ─────────────────────────────────────────────────────────

export function createKlingRenderer(): KlingCommercialRenderer {
  return new KlingCommercialRenderer();
}
