import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, klingSceneJobsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { getSceneManager, checkSceneManagerRequirements, COMMERCIAL_SCENE_STRUCTURE } from "../lib/sceneManager.js";
import { getRenderQueue } from "../lib/renderQueue.js";
import { getVideoProviderCapabilities } from "../lib/videoProviderConfig.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "scenes.route" });

// ── GET /video-provider-capabilities ──────────────────────────────────────────
// Not project-scoped (registered before the :id param hook below) — lets the
// format picker know which aspect ratios the currently active render provider
// actually supports, without ever exposing which provider that is.
router.get("/video-provider-capabilities", (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  res.json(getVideoProviderCapabilities());
});

router.param("id", requireProjectOwnershipParam());

// ── POST /projects/:id/videos/:videoId/scenes/generate ────────────────────────
// Decomposes the video's Commercial Blueprint into 6 cinematic scenes using AI,
// stores them in the DB, and starts independent background rendering for each.
//
// Idempotency:
//   • If a decomposition is already in flight for this video (same server process),
//     returns 409 so the client knows to poll the existing scene list instead.
//   • If all 6 scenes exist with the same blueprint fingerprint and none failed,
//     SceneManager returns cached scenes without calling Claude.
//   • If scenes are already submitted/processing, returns 409 with current progress
//     so clients know not to re-trigger.
router.post("/projects/:id/videos/:videoId/scenes/generate", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);

  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  // Check at least one video render provider (Wan or Kling) is configured.
  // Never surface the specific missing env vars / vendor names to the client —
  // that's internal infrastructure detail. Full detail goes to the server log
  // only, for the operator to act on.
  const { ready, missing } = checkSceneManagerRequirements();
  if (!ready) {
    logger.error({ missing }, "[scenes] Video generation unavailable — missing configuration");
    res.status(503).json({
      error: "Video generation is temporarily unavailable",
      message: "Please try again later or contact support if this persists.",
    });
    return;
  }

  // Verify video exists and belongs to the project
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (!video.script && !video.storyboard && !video.cinematicPlan) {
    res.status(422).json({
      error: "No blueprint available",
      message: "This video has no script, storyboard, or cinematic plan. Generate a Commercial Blueprint first.",
    });
    return;
  }

  const queue = getRenderQueue();

  // ── In-flight guard (in-process lock) ─────────────────────────────────────
  // Prevents two simultaneous requests from both calling Claude and overwriting
  // each other's scene records.
  if (queue.isDecompositionInFlight(videoId)) {
    logger.info({ projectId, videoId, userId }, "[scenes] Decomposition already in flight — returning 409");

    const existingScenes = await getSceneManager().getVideoScenes(videoId);
    const statusCounts = buildStatusCounts(existingScenes);

    res.status(409).json({
      error: "Scene generation already in progress",
      message: "A decomposition is already running for this video. Poll GET /scenes to track progress.",
      videoId,
      progress: buildProgress(existingScenes, statusCounts),
      scenes: existingScenes.map(formatScene),
    });
    return;
  }

  // ── Active scenes guard (DB state) ────────────────────────────────────────
  // After a server restart the in-process lock is gone, but scenes in
  // "submitted"/"processing" are still running on Kling's side. Don't restart.
  const existingScenes = await getSceneManager().getVideoScenes(videoId);
  const activeStatuses = existingScenes.filter(s =>
    s.status === "submitted" || s.status === "processing",
  );

  if (activeStatuses.length > 0) {
    logger.info(
      { projectId, videoId, activeCount: activeStatuses.length },
      "[scenes] Active Kling scenes — refusing re-generation",
    );
    const statusCounts = buildStatusCounts(existingScenes);
    res.status(409).json({
      error: "Scenes are already rendering",
      message: `${activeStatuses.length} scene(s) are actively rendering. Poll GET /scenes to track progress.`,
      videoId,
      progress: buildProgress(existingScenes, statusCounts),
      scenes: existingScenes.map(formatScene),
    });
    return;
  }

  // ── Update aspect ratio before decomposition ──────────────────────────────
  // The client sends the user-selected output format ("landscape"/"square"/"vertical")
  // as `aspectRatio`. We map it to the Kling aspect ratio string and persist it so
  // both scene generation (Kling) and assembly (FFmpeg) use the same target format.
  const FORMAT_TO_AR: Record<string, string> = {
    landscape: "16:9",
    square: "1:1",
    vertical: "9:16",
  };
  const bodyAr = typeof req.body?.aspectRatio === "string" ? req.body.aspectRatio : null;
  const resolvedAr = (bodyAr && FORMAT_TO_AR[bodyAr]) ? FORMAT_TO_AR[bodyAr] : null;
  if (resolvedAr) {
    await db
      .update(videosTable)
      .set({ aspectRatio: resolvedAr })
      .where(eq(videosTable.id, videoId));
    logger.info({ videoId, aspectRatio: resolvedAr }, "[scenes] Updated video aspect ratio before decomposition");
  }

  logger.info({ projectId, videoId, userId }, "[scenes] Starting blueprint decomposition");

  const manager = getSceneManager();

  // Acquire the per-video decomposition lock before calling Claude
  const releaseLock = await queue.acquireDecompositionLock(videoId);

  let scenes;
  try {
    // AI decomposition — synchronous (creates scene records, returns them).
    // Returns cached scenes if the blueprint hasn't changed.
    scenes = await manager.decomposeBlueprint(videoId, projectId);
  } catch (err) {
    // Full error (may reference internal AI providers) stays server-side only.
    logger.error({ err, videoId }, "[scenes] Blueprint decomposition failed");
    res.status(500).json({
      error: "Failed to generate scenes",
      message: "Please try again in a moment. Contact support if this keeps happening.",
    });
    return;
  } finally {
    releaseLock();
  }

  // Update video render status to show scene generation is underway
  await db
    .update(videosTable)
    .set({ renderStatus: "processing", renderStartedAt: new Date(), renderError: null })
    .where(eq(videosTable.id, videoId));

  // Fire-and-forget: submit each pending scene to Kling independently.
  // The global render queue caps concurrent submissions across all users.
  manager.startSceneRendering(videoId);

  logger.info({ videoId, sceneCount: scenes.length }, "[scenes] Scenes created — rendering started");

  res.status(201).json({
    videoId,
    sceneCount: scenes.length,
    structure: COMMERCIAL_SCENE_STRUCTURE.map(s => ({ type: s.type, name: s.name, timeHint: s.timeHint })),
    scenes: scenes.map(formatScene),
  });
});

// ── GET /projects/:id/videos/:videoId/scenes ──────────────────────────────────
// Returns all scene records for the video with current status and progress summary.
router.get("/projects/:id/videos/:videoId/scenes", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);

  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const scenes = await getSceneManager().getVideoScenes(videoId);
  const statusCounts = buildStatusCounts(scenes);

  res.json({
    videoId,
    totalScenes: scenes.length,
    progress: buildProgress(scenes, statusCounts),
    allComplete: scenes.length > 0 && (statusCounts["succeed"] ?? 0) === scenes.length,
    scenes: scenes.map(formatScene),
  });
});

// ── POST /projects/:id/videos/:videoId/scenes/:sceneId/retry ─────────────────
// Retries a single failed scene. Never touches successful scenes.
// Enforces a hard cap of 3 user-initiated retries per scene.
router.post("/projects/:id/videos/:videoId/scenes/:sceneId/retry", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  const sceneId = parseInt(req.params.sceneId, 10);

  if (isNaN(projectId) || isNaN(videoId) || isNaN(sceneId)) {
    res.status(400).json({ error: "Invalid project, video, or scene ID" });
    return;
  }

  // Verify video ownership
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // Verify scene belongs to this video
  const [scene] = await db
    .select()
    .from(klingSceneJobsTable)
    .where(and(eq(klingSceneJobsTable.id, sceneId), eq(klingSceneJobsTable.videoId, videoId)));

  if (!scene) {
    res.status(404).json({ error: "Scene not found" });
    return;
  }

  if (scene.status !== "failed") {
    res.status(409).json({
      error: "Scene is not in a retryable state",
      currentStatus: scene.status,
      message: `Only failed scenes can be retried. This scene is currently: ${scene.status}`,
    });
    return;
  }

  logger.info(
    { projectId, videoId, sceneId, sceneIndex: scene.sceneIndex, retryCount: scene.retryCount },
    "[scenes] Retrying failed scene",
  );

  try {
    const updated = await getSceneManager().retryScene(sceneId);
    res.json({
      message: `Scene ${scene.sceneName ?? `#${scene.sceneIndex + 1}`} retry started`,
      scene: formatScene(updated),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Retry failed";
    logger.error({ err, sceneId }, "[scenes] Retry failed");

    // Distinguish retry cap errors (409) from unexpected errors (500)
    const status = msg.includes("maximum") ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

// ── GET /projects/:id/videos/:videoId/scenes/structure ───────────────────────
// Returns the canonical 6-scene commercial structure.
router.get("/projects/:id/videos/:videoId/scenes/structure", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  res.json({
    structure: COMMERCIAL_SCENE_STRUCTURE,
    totalScenes: COMMERCIAL_SCENE_STRUCTURE.length,
    totalDurationSec: 30,
    sceneDurationSec: 5,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildStatusCounts(scenes: (typeof klingSceneJobsTable.$inferSelect)[]): Record<string, number> {
  return scenes.reduce((acc, s) => {
    const key = s.status as string;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function buildProgress(
  scenes: (typeof klingSceneJobsTable.$inferSelect)[],
  statusCounts: Record<string, number>,
) {
  const totalScenes = scenes.length;
  const completedScenes = statusCounts["succeed"] ?? 0;
  return {
    completed: completedScenes,
    inProgress: (statusCounts["submitted"] ?? 0) + (statusCounts["processing"] ?? 0),
    pending: statusCounts["pending"] ?? 0,
    failed: statusCounts["failed"] ?? 0,
    percentComplete: totalScenes > 0 ? Math.round((completedScenes / totalScenes) * 100) : 0,
  };
}

// ── Response formatter ────────────────────────────────────────────────────────
//
// IMPORTANT: this response is customer-facing. Never include internal
// implementation details here — render provider name, vendor task/job IDs,
// model identifiers, or raw provider error text all reveal which backend
// vendors/APIs power the product. Keep those fields DB-only / admin-only
// (see routes/renderAdmin.ts, which is behind requireAdmin) and sanitize the
// error message shown to customers to a generic, actionable-but-anonymous string.

function sanitizeSceneError(errorMessage: string | null): string | null {
  if (!errorMessage) return null;
  return "Scene generation failed. We're retrying automatically — please check back shortly.";
}

function formatScene(s: typeof klingSceneJobsTable.$inferSelect) {
  return {
    id: s.id,
    videoId: s.videoId,
    sceneIndex: s.sceneIndex,
    sceneName: s.sceneName,
    sceneType: s.sceneType,
    status: s.status,
    // Cinematic metadata
    metadata: {
      environment: s.environment,
      cameraMovement: s.cameraMovement,
      lighting: s.lighting,
      mood: s.mood,
      composition: s.composition,
      motion: s.motion,
      brandStyle: s.brandStyle,
      marketingObjective: s.marketingObjective,
    },
    aspectRatio: s.aspectRatio,
    // Result
    videoUrl: s.videoUrl,
    durationSec: s.durationSec,
    // Error & retry (sanitized — no internal/vendor detail)
    errorMessage: sanitizeSceneError(s.errorMessage),
    retryCount: s.retryCount,
    lastRetryAt: s.lastRetryAt,
    // Timestamps
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export default router;
