import { createHash } from "crypto";
import pino from "pino";
import { db } from "@workspace/db";
import { klingSceneJobsTable, videosTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateJson } from "./aiJson.js";
import { getGroundingContext, renderGroundingBlock } from "./projectContext.js";
import { getRenderQueue } from "./renderQueue.js";
import type { CommercialSceneType, KlingSceneJob } from "@workspace/db";

const logger = pino({ name: "sceneManager" });

// ── Official Kling API ────────────────────────────────────────────────────────
const KLING_BASE_URL = "https://api-singapore.klingai.com";
const KLING_DEFAULT_MODEL = "kling-v2-5-turbo";
const KLING_DURATION = "5";
const KLING_DURATION_SEC = 5;
const KLING_MODE = "std";
const KLING_MAX_POLLS = 120;       // 120 × 10 s = 20 min per scene
const KLING_POLL_INTERVAL_MS = 10_000;
const KLING_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, ugly, pixelated, amateur, watermark, text overlay, logo";

/**
 * Hard cap on per-scene user-initiated retries via the /retry route.
 * Automatic recovery by RenderMonitor uses its own separate counter check.
 */
const MAX_USER_RETRIES = 3;

// ── 6-Scene commercial structure ──────────────────────────────────────────────
export const COMMERCIAL_SCENE_STRUCTURE: Array<{
  type: CommercialSceneType;
  name: string;
  objective: string;
  timeHint: string;
}> = [
  {
    type: "hook",
    name: "Hook",
    objective: "Grab attention in the first 3 seconds with a visually striking, relatable moment",
    timeHint: "0–5 s",
  },
  {
    type: "problem",
    name: "Problem",
    objective: "Show the viewer's pain point or frustration in a visceral, empathetic way",
    timeHint: "5–10 s",
  },
  {
    type: "solution",
    name: "Solution",
    objective: "Introduce the product or service as the clear, effortless answer",
    timeHint: "10–15 s",
  },
  {
    type: "benefits",
    name: "Benefits",
    objective: "Visually demonstrate the 3 most compelling benefits — show, don't tell",
    timeHint: "15–20 s",
  },
  {
    type: "proof",
    name: "Proof",
    objective: "Build trust with social proof, results, or transformation moments",
    timeHint: "20–25 s",
  },
  {
    type: "cta",
    name: "Call to Action",
    objective: "Drive immediate action with urgency, a clear next step, and brand confidence",
    timeHint: "25–30 s",
  },
];

// ── AI decomposition types ────────────────────────────────────────────────────

interface AISceneDescriptor {
  sceneIndex: number;
  sceneName: string;
  sceneType: CommercialSceneType;
  environment: string;
  cameraMovement: string;
  lighting: string;
  mood: string;
  composition: string;
  motion: string;
  brandStyle: string;
  marketingObjective: string;
  klingPrompt: string;
}

interface AIDecompositionResult {
  scenes: AISceneDescriptor[];
}

// ── Kling API types ───────────────────────────────────────────────────────────

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg?: string;
  task_result?: { videos?: Array<{ id: string; url: string; duration: string }> };
}

interface KlingApiResponse {
  code: number;
  message: string;
  request_id?: string;
  data: KlingTaskData;
}

// ── SceneManager ──────────────────────────────────────────────────────────────

export class SceneManager {
  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Decomposes the video's Commercial Blueprint into 6 cinematic scenes using AI.
   *
   * Idempotency: Computes a SHA-256 fingerprint of the blueprint content
   * (script + storyboard + cinematicPlan). If all 6 scene records already exist
   * with the same fingerprint and none have failed, returns the cached scenes
   * without calling Claude — reducing AI spend on repeated calls.
   *
   * Duplicate prevention: Uses a per-video in-process lock so that two
   * simultaneous requests for the same video don't both run Claude and
   * overwrite each other's DB records.
   *
   * Creates (or refreshes) scene records in the DB and returns them.
   * Does NOT start rendering.
   */
  async decomposeBlueprint(videoId: number, projectId: number): Promise<KlingSceneJob[]> {
    logger.info({ videoId, projectId }, "[SceneManager] Decomposing blueprint into scenes");

    const video = await this.loadVideo(videoId);
    if (!video) throw new Error(`Video ${videoId} not found`);

    // ── Prompt fingerprint ─────────────────────────────────────────────────
    const blueprintContent = (video.script ?? "") + (video.storyboard ?? "") + (video.cinematicPlan ?? "");
    const promptHash = createHash("sha256").update(blueprintContent).digest("hex");

    // ── Cache hit check ────────────────────────────────────────────────────
    // If all 6 scenes already exist with the same hash and none have failed,
    // skip the Claude call and return the cached rows.
    const existing = await db
      .select()
      .from(klingSceneJobsTable)
      .where(eq(klingSceneJobsTable.videoId, videoId))
      .orderBy(klingSceneJobsTable.sceneIndex);

    const allMatch = existing.length === 6
      && existing.every(s => s.promptHash === promptHash)
      && existing.every(s => s.status !== "failed");

    if (allMatch) {
      logger.info(
        { videoId, promptHash: promptHash.slice(0, 8) },
        "[SceneManager] Blueprint unchanged — returning cached scenes (no Claude call)",
      );
      return existing;
    }

    // ── Load grounding context ─────────────────────────────────────────────
    const ctx = await getGroundingContext(projectId).catch(() => null);
    const groundingBlock = ctx ? renderGroundingBlock(ctx) : null;

    const aspectRatio = video.aspectRatio ?? "16:9";
    const klingAspectRatio = this.normaliseAspectRatio(aspectRatio);

    const scenes = await this.callDecomposeAI(video, groundingBlock);

    logger.info(
      { videoId, sceneCount: scenes.length },
      "[SceneManager] AI decomposition complete — creating scene records",
    );

    // Delete existing records for this video before inserting fresh ones
    await db.delete(klingSceneJobsTable).where(eq(klingSceneJobsTable.videoId, videoId));

    const rows = await db
      .insert(klingSceneJobsTable)
      .values(
        scenes.map(s => ({
          videoId,
          sceneIndex: s.sceneIndex,
          sceneName: s.sceneName,
          sceneType: s.sceneType,
          environment: s.environment,
          cameraMovement: s.cameraMovement,
          lighting: s.lighting,
          mood: s.mood,
          composition: s.composition,
          motion: s.motion,
          brandStyle: s.brandStyle,
          marketingObjective: s.marketingObjective,
          prompt: s.klingPrompt,
          promptHash,
          status: "pending" as const,
          model: KLING_DEFAULT_MODEL,
          aspectRatio: klingAspectRatio,
          retryCount: 0,
        })),
      )
      .returning();

    logger.info(
      { videoId, sceneIds: rows.map(r => r.id), promptHash: promptHash.slice(0, 8) },
      "[SceneManager] Scene records created in DB",
    );
    return rows;
  }

  /**
   * Fire-and-forget: starts independent background rendering for every pending
   * scene in a video. Scenes that are already submitted/processing/succeed are
   * left untouched — only "pending" scenes are started.
   */
  startSceneRendering(videoId: number): void {
    this.runSceneRendering(videoId).catch(err => {
      logger.error({ err, videoId }, "[SceneManager] startSceneRendering unhandled error");
    });
  }

  /**
   * Retries a single failed scene without touching any other scenes.
   *
   * Enforces a hard cap of MAX_USER_RETRIES (3) per scene to prevent
   * unbounded Kling spend from repeated manual retries.
   *
   * Increments retryCount, resets status to pending, then processes it.
   */
  async retryScene(sceneJobId: number): Promise<KlingSceneJob> {
    const scene = await this.loadScene(sceneJobId);
    if (!scene) throw new Error(`Scene job ${sceneJobId} not found`);
    if (scene.status !== "failed") {
      throw new Error(`Scene ${sceneJobId} is not in failed state (current: ${scene.status})`);
    }

    // Enforce retry cap — automatic recovery does not count toward this limit
    // since it uses its own check in RenderMonitor.
    if (scene.retryCount >= MAX_USER_RETRIES) {
      throw new Error(
        `Scene ${sceneJobId} has reached the maximum of ${MAX_USER_RETRIES} retries. ` +
        `Contact support if the issue persists.`,
      );
    }

    logger.info(
      { sceneJobId, sceneIndex: scene.sceneIndex, retryCount: scene.retryCount, maxRetries: MAX_USER_RETRIES },
      "[SceneManager] Retrying failed scene",
    );

    const [updated] = await db
      .update(klingSceneJobsTable)
      .set({
        status: "pending",
        klingTaskId: null,
        externalTaskId: null,
        errorMessage: null,
        videoUrl: null,
        retryCount: scene.retryCount + 1,
        lastRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(klingSceneJobsTable.id, sceneJobId))
      .returning();

    // Process this scene independently in the background
    this.processScene(sceneJobId).catch(err => {
      logger.error({ err, sceneJobId }, "[SceneManager] retryScene background error");
    });

    return updated!;
  }

  /** Returns all scene records for a video, ordered by scene index. */
  async getVideoScenes(videoId: number): Promise<KlingSceneJob[]> {
    return db
      .select()
      .from(klingSceneJobsTable)
      .where(eq(klingSceneJobsTable.videoId, videoId))
      .orderBy(klingSceneJobsTable.sceneIndex);
  }

  // ── Internal: rendering orchestration ────────────────────────────────────

  private async runSceneRendering(videoId: number): Promise<void> {
    const scenes = await db
      .select()
      .from(klingSceneJobsTable)
      .where(
        and(
          eq(klingSceneJobsTable.videoId, videoId),
          eq(klingSceneJobsTable.status, "pending"),
        ),
      );

    if (scenes.length === 0) {
      logger.info({ videoId }, "[SceneManager] No pending scenes to start");
      return;
    }

    logger.info(
      { videoId, pendingScenes: scenes.map(s => s.id) },
      "[SceneManager] Starting independent rendering for pending scenes",
    );

    // Each scene runs completely independently — one failure does not affect others.
    // Each processScene call will acquire its own slot from the global render queue,
    // so all 6 launches happen immediately but only KLING_CONCURRENCY run at once
    // across ALL videos from ALL users.
    await Promise.allSettled(scenes.map(s => this.processScene(s.id)));
  }

  // ── Internal: single-scene lifecycle ──────────────────────────────────────

  /**
   * Handles the full lifecycle of one scene: submit → poll → download → store.
   *
   * Before submitting to Kling, acquires a slot from the global concurrency queue
   * (capped by KLING_CONCURRENCY env var, default 12). This prevents thundering-
   * herd API abuse when many users generate simultaneously.
   *
   * Updates the DB at every status transition. Any failure is logged and
   * recorded in DB — the scene moves to "failed" and the rest are unaffected.
   */
  private async processScene(sceneJobId: number): Promise<void> {
    const scene = await this.loadScene(sceneJobId);
    if (!scene) {
      logger.error({ sceneJobId }, "[SceneManager] processScene: scene not found");
      return;
    }

    logger.info(
      { sceneJobId, sceneIndex: scene.sceneIndex, sceneName: scene.sceneName },
      "[SceneManager] Processing scene",
    );

    // ── Step 1: Acquire Kling concurrency slot ───────────────────────────────
    const queue = getRenderQueue();
    let releaseSlot: ((success?: boolean) => void) | null = null;

    try {
      logger.debug(
        { sceneJobId, sceneIndex: scene.sceneIndex },
        "[SceneManager] Waiting for Kling slot",
      );
      releaseSlot = await queue.acquireKling();
    } catch (err) {
      logger.error({ err, sceneJobId }, "[SceneManager] Failed to acquire Kling slot");
      await this.markSceneFailed(sceneJobId, "Failed to acquire render slot");
      return;
    }

    let klingTaskId: string;

    try {
      // ── Step 2: Submit to Kling ────────────────────────────────────────────
      const externalTaskId = `gf-v${scene.videoId}-s${scene.sceneIndex}-${Date.now()}`;

      try {
        klingTaskId = await this.submitToKling(scene.prompt, scene.aspectRatio, externalTaskId);
        await db
          .update(klingSceneJobsTable)
          .set({ klingTaskId, externalTaskId, status: "submitted", updatedAt: new Date() })
          .where(eq(klingSceneJobsTable.id, sceneJobId));

        logger.info(
          { sceneJobId, sceneIndex: scene.sceneIndex, klingTaskId },
          "[SceneManager] Scene submitted to Kling — task created",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, sceneJobId, sceneIndex: scene.sceneIndex }, "[SceneManager] Scene submission failed");
        await this.markSceneFailed(sceneJobId, `Submission failed: ${msg}`);
        releaseSlot(false);
        releaseSlot = null;
        return;
      }

      // ── Step 3: Release Kling slot — we've submitted, poll is cheap ────────
      // The Kling API is only "busy" during the submit call itself. Polling and
      // downloading happen independently so the slot can be freed now to let
      // other scenes submit.
      releaseSlot(true);
      releaseSlot = null;

      // ── Step 4: Poll until terminal ────────────────────────────────────────
      try {
        const storedUrl = await this.pollUntilComplete(sceneJobId, scene.sceneIndex, klingTaskId, scene.videoId);
        logger.info(
          { sceneJobId, sceneIndex: scene.sceneIndex, storedUrl },
          "[SceneManager] Scene complete and stored",
        );
      } catch (err) {
        // pollUntilComplete already wrote the failure to DB
        logger.error({ err, sceneJobId, sceneIndex: scene.sceneIndex }, "[SceneManager] Scene polling/download failed");
      }
    } finally {
      // Safety net: always release if not already released
      if (releaseSlot) {
        releaseSlot(false);
      }
    }
  }

  // ── Internal: Kling API calls ─────────────────────────────────────────────

  private async submitToKling(
    prompt: string,
    aspectRatio: string,
    externalTaskId: string,
  ): Promise<string> {
    return withRetry(async () => {
      const res = await fetch(`${KLING_BASE_URL}/v1/videos/text2video`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_name: KLING_DEFAULT_MODEL,
          prompt,
          negative_prompt: KLING_NEGATIVE_PROMPT,
          duration: KLING_DURATION,
          mode: KLING_MODE,
          aspect_ratio: aspectRatio,
          sound: "off",
          external_task_id: externalTaskId,
        }),
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
        { klingTaskId: json.data.task_id, externalTaskId },
        "[SceneManager] Kling task created",
      );
      return json.data.task_id;
    });
  }

  private async pollUntilComplete(
    sceneJobId: number,
    sceneIndex: number,
    klingTaskId: string,
    videoId: number,
  ): Promise<string> {
    logger.info({ sceneJobId, sceneIndex, klingTaskId }, "[SceneManager] Starting poll loop");

    for (let poll = 0; poll < KLING_MAX_POLLS; poll++) {
      await sleep(KLING_POLL_INTERVAL_MS);

      let taskData: KlingTaskData;
      try {
        taskData = await withRetry(async () => {
          const res = await fetch(`${KLING_BASE_URL}/v1/videos/text2video/${klingTaskId}`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            signal: AbortSignal.timeout(15_000),
          });
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
        // Individual poll failures are non-fatal — log and continue
        logger.warn(
          { err, sceneJobId, sceneIndex, klingTaskId, poll },
          "[SceneManager] Poll request failed — retrying next interval",
        );
        continue;
      }

      logger.debug(
        { sceneJobId, sceneIndex, status: taskData.task_status, poll },
        "[SceneManager] Poll tick",
      );

      if (taskData.task_status === "processing") {
        await db
          .update(klingSceneJobsTable)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(klingSceneJobsTable.id, sceneJobId));
      }

      if (taskData.task_status === "succeed") {
        const remoteUrl = taskData.task_result?.videos?.[0]?.url;
        if (!remoteUrl) {
          const msg = `Kling returned succeed but no video URL (task=${klingTaskId})`;
          logger.error({ sceneJobId, sceneIndex, klingTaskId }, `[SceneManager] ${msg}`);
          await this.markSceneFailed(sceneJobId, msg);
          throw new Error(msg);
        }

        logger.info(
          { sceneJobId, sceneIndex, klingTaskId, remoteUrl },
          "[SceneManager] Scene ready — downloading from Kling CDN",
        );

        const storedKey = await this.downloadAndStore(remoteUrl, videoId, sceneIndex);

        await db
          .update(klingSceneJobsTable)
          .set({
            status: "succeed",
            videoUrl: storedKey,
            durationSec: KLING_DURATION_SEC,
            updatedAt: new Date(),
          })
          .where(eq(klingSceneJobsTable.id, sceneJobId));

        logger.info(
          { sceneJobId, sceneIndex, storedKey },
          "[SceneManager] Scene downloaded and stored — marking succeed",
        );
        return storedKey;
      }

      if (taskData.task_status === "failed") {
        const msg = taskData.task_status_msg ?? `Kling generation failed (task=${klingTaskId})`;
        logger.error({ sceneJobId, sceneIndex, klingTaskId, msg }, "[SceneManager] Kling reported failure");
        await this.markSceneFailed(sceneJobId, msg);
        throw new Error(`Kling scene failed: ${msg}`);
      }
    }

    const timeoutMin = (KLING_MAX_POLLS * KLING_POLL_INTERVAL_MS) / 60_000;
    const msg = `Scene timed out after ${timeoutMin} min (task=${klingTaskId})`;
    logger.error({ sceneJobId, sceneIndex, klingTaskId }, `[SceneManager] ${msg}`);
    await this.markSceneFailed(sceneJobId, msg);
    throw new Error(msg);
  }

  // ── Internal: AI decomposition ────────────────────────────────────────────

  private async callDecomposeAI(
    video: Awaited<ReturnType<typeof this.loadVideo>>,
    groundingBlock: string | null,
  ): Promise<AISceneDescriptor[]> {
    if (!video) throw new Error("No video");

    const systemPrompt = `You are a world-class commercial director and AI video generation specialist.
Your task is to decompose a commercial video brief into exactly 6 scenes following the standard commercial structure.

Each scene must include 8 cinematic metadata fields AND a ready-to-use Kling AI text-to-video prompt.

Scene structure (always in this exact order):
${COMMERCIAL_SCENE_STRUCTURE.map((s, i) => `${i + 1}. ${s.name} (${s.timeHint}): ${s.objective}`).join("\n")}

For each scene, the 8 metadata fields are:
- environment: Specific location, setting, time of day, weather (be cinematic and precise)
- cameraMovement: Camera motion technique (push-in, pull-back, pan, tracking shot, handheld, drone, etc.)
- lighting: Lighting setup and quality (golden hour, studio soft-box, neon backlit, etc.)
- mood: Emotional tone and energy the viewer should feel (3–5 words)
- composition: Visual framing and layout (rule of thirds, centered, symmetrical, close-up, wide, etc.)
- motion: Subject movement and action within the frame (precise and visual)
- brandStyle: How brand identity appears visually (colors, aesthetic, product placement)
- marketingObjective: One sentence — what this specific scene must achieve commercially

The Kling prompt must be:
- Photorealistic, cinema-grade, 4K quality
- 450–500 characters max
- Actionable visual description (no dialogue, no text)
- Structured: [style]. [environment]. [subject action]. [camera]. [lighting]. [mood].

Return ONLY valid JSON in this exact shape:
{
  "scenes": [
    {
      "sceneIndex": 0,
      "sceneName": "Hook",
      "sceneType": "hook",
      "environment": "...",
      "cameraMovement": "...",
      "lighting": "...",
      "mood": "...",
      "composition": "...",
      "motion": "...",
      "brandStyle": "...",
      "marketingObjective": "...",
      "klingPrompt": "..."
    }
  ]
}`;

    const userPrompt = `Create 6 commercial scenes for this video:

Title: ${video.title}
Script: ${video.script ?? "(not provided)"}
Storyboard: ${video.storyboard ?? "(not provided)"}
Duration: ${video.duration ?? 30} seconds
Aspect ratio: ${video.aspectRatio ?? "16:9"}
${groundingBlock ? `\nBusiness context:\n${groundingBlock}` : ""}

Generate exactly 6 scenes (one per commercial section). Make every scene visually distinct and commercially potent.`;

    logger.info({ videoId: video.id }, "[SceneManager] Calling Claude for scene decomposition");

    const result = await generateJson<AIDecompositionResult>({
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 4096,
      label: `scene decomposition — video #${video.id}`,
    });

    if (!Array.isArray(result.scenes) || result.scenes.length === 0) {
      throw new Error("AI returned empty scenes array");
    }

    // Ensure sceneType matches our known types — gracefully coerce unknown values
    const knownTypes: CommercialSceneType[] = ["hook", "problem", "solution", "benefits", "proof", "cta"];
    return result.scenes.map((s, i) => ({
      ...s,
      sceneIndex: i,
      sceneType: knownTypes.includes(s.sceneType as CommercialSceneType)
        ? (s.sceneType as CommercialSceneType)
        : (COMMERCIAL_SCENE_STRUCTURE[i]?.type ?? "hook"),
      sceneName: s.sceneName || COMMERCIAL_SCENE_STRUCTURE[i]?.name || `Scene ${i + 1}`,
    }));
  }

  // ── Internal: storage ─────────────────────────────────────────────────────

  /**
   * Downloads the Kling CDN video and stores it permanently in object storage.
   *
   * The object key is deterministic (video-{id}-scene-{index}.mp4) rather than
   * timestamped, so re-downloads overwrite the previous file instead of creating
   * orphaned objects that eat storage costs. The stored key — not a signed URL —
   * is what's persisted in the DB; fresh signed URLs are generated on demand.
   */
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
      "[SceneManager] Scene downloaded — uploading to object storage",
    );

    const { objectStorageClient, signObjectURL } = await import("./objectStorage.js");
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

    const bucket = objectStorageClient.bucket(bucketId);

    // Deterministic key — overwrites on retry rather than accumulating orphaned files
    const objectName = `renders/kling/video-${videoId}-scene-${sceneIndex}.mp4`;
    await bucket.file(objectName).save(buffer, { metadata: { contentType: "video/mp4" } });

    // Return a fresh signed URL valid for 4 hours.
    // The raw objectName is NOT stored in the DB here — only the signed URL.
    // RenderMonitor or a dedicated /refresh-url route can issue new signed URLs
    // from the stored klingTaskId + objectName pattern when needed.
    return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14_400 });
  }

  // ── Internal: DB helpers ──────────────────────────────────────────────────

  private async loadVideo(videoId: number) {
    const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
    return video ?? null;
  }

  private async loadScene(sceneJobId: number): Promise<KlingSceneJob | null> {
    const [scene] = await db
      .select()
      .from(klingSceneJobsTable)
      .where(eq(klingSceneJobsTable.id, sceneJobId));
    return scene ?? null;
  }

  private async markSceneFailed(sceneJobId: number, errorMessage: string): Promise<void> {
    await db
      .update(klingSceneJobsTable)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(eq(klingSceneJobsTable.id, sceneJobId));
  }

  // ── Internal: Kling helpers ───────────────────────────────────────────────

  private get apiKey(): string {
    const key = process.env.KLING_API_KEY;
    if (!key) throw new Error("KLING_API_KEY environment variable is not configured");
    return key;
  }

  private normaliseAspectRatio(ar: string): string {
    // Kling supports: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 — map 4:5 to 9:16
    if (ar === "4:5") return "9:16";
    return ar;
  }
}

// ── Availability check ────────────────────────────────────────────────────────

export function checkSceneManagerRequirements(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.KLING_API_KEY) missing.push("KLING_API_KEY");
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return { ready: missing.length === 0, missing };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: SceneManager | null = null;
export function getSceneManager(): SceneManager {
  if (!_instance) _instance = new SceneManager();
  return _instance;
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
        "[SceneManager] Transient error — retrying with backoff",
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
