import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, klingSceneJobsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { getSceneManager, checkSceneManagerRequirements, COMMERCIAL_SCENE_STRUCTURE } from "../lib/sceneManager.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "scenes.route" });

router.param("id", requireProjectOwnershipParam());

// ── POST /projects/:id/videos/:videoId/scenes/generate ────────────────────────
// Decomposes the video's Commercial Blueprint into 6 cinematic scenes using AI,
// stores them in the DB, and starts independent background rendering for each.
// If scenes already exist for this video they are replaced (re-generate).
router.post("/projects/:id/videos/:videoId/scenes/generate", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);

  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  // Check Kling is configured
  const { ready, missing } = checkSceneManagerRequirements();
  if (!ready) {
    res.status(503).json({
      error: "Scene generation is not configured",
      missing,
      message: `Set the following environment variables to enable scene generation: ${missing.join(", ")}`,
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

  logger.info({ projectId, videoId, userId }, "[scenes] Starting blueprint decomposition");

  const manager = getSceneManager();

  let scenes;
  try {
    // AI decomposition — synchronous (creates scene records, returns them)
    scenes = await manager.decomposeBlueprint(videoId, projectId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scene decomposition failed";
    logger.error({ err, videoId }, "[scenes] Blueprint decomposition failed");
    res.status(500).json({ error: "Failed to decompose blueprint into scenes", detail: msg });
    return;
  }

  // Update video render status to show scene generation is underway
  await db
    .update(videosTable)
    .set({ renderStatus: "processing", renderStartedAt: new Date(), renderError: null })
    .where(eq(videosTable.id, videoId));

  // Fire-and-forget: submit each scene to Kling independently in the background
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

  const statusCounts = scenes.reduce(
    (acc, s) => {
      const key = s.status as string;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const totalScenes = scenes.length;
  const completedScenes = statusCounts["succeed"] ?? 0;
  const failedScenes = statusCounts["failed"] ?? 0;
  const inProgressScenes = (statusCounts["submitted"] ?? 0) + (statusCounts["processing"] ?? 0);
  const pendingScenes = statusCounts["pending"] ?? 0;

  res.json({
    videoId,
    totalScenes,
    progress: {
      completed: completedScenes,
      inProgress: inProgressScenes,
      pending: pendingScenes,
      failed: failedScenes,
      percentComplete: totalScenes > 0 ? Math.round((completedScenes / totalScenes) * 100) : 0,
    },
    allComplete: totalScenes > 0 && completedScenes === totalScenes,
    scenes: scenes.map(formatScene),
  });
});

// ── POST /projects/:id/videos/:videoId/scenes/:sceneId/retry ─────────────────
// Retries a single failed scene. Never touches successful scenes.
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
    res.status(500).json({ error: "Failed to retry scene", detail: msg });
  }
});

// ── GET /projects/:id/videos/:videoId/scenes/structure ───────────────────────
// Returns the canonical 6-scene commercial structure (no auth required for this).
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

// ── Response formatter ────────────────────────────────────────────────────────

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
    // Kling render info
    klingTaskId: s.klingTaskId,
    externalTaskId: s.externalTaskId,
    model: s.model,
    aspectRatio: s.aspectRatio,
    // Result
    videoUrl: s.videoUrl,
    durationSec: s.durationSec,
    // Error & retry
    errorMessage: s.errorMessage,
    retryCount: s.retryCount,
    lastRetryAt: s.lastRetryAt,
    // Timestamps
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export default router;
