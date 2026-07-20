import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { checkRenderRequirements, startVideoRender, type RenderResolution, type AspectRatio } from "../lib/videoRenderPipeline.js";

const router = Router();

router.param("id", requireProjectOwnershipParam());

// ── Start a video render ──────────────────────────────────────────────────────
router.post("/projects/:id/videos/:videoId/render", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);

  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  const {
    resolution = "1080p",
    aspectRatio = "16:9",
    captionsEnabled = false,
  } = req.body as {
    resolution?: RenderResolution;
    aspectRatio?: string;
    captionsEnabled?: boolean;
  };

  const validResolutions = ["1080p", "4k"];
  const validAspectRatios = ["16:9", "9:16", "1:1", "4:5"];
  if (!validResolutions.includes(resolution)) {
    res.status(400).json({ error: `resolution must be one of: ${validResolutions.join(", ")}` });
    return;
  }
  if (!validAspectRatios.includes(aspectRatio)) {
    res.status(400).json({ error: `aspectRatio must be one of: ${validAspectRatios.join(", ")}` });
    return;
  }

  const [video] = await db.select().from(videosTable).where(
    and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId))
  );
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (video.renderStatus === "queued" || video.renderStatus === "processing") {
    res.status(409).json({ error: "A render is already in progress for this video" });
    return;
  }

  const { ready, missing } = checkRenderRequirements();
  if (!ready) {
    res.status(503).json({
      error: "Video rendering is not yet configured",
      missing,
      message: `Set the following environment variables to enable video rendering: ${missing.join(", ")}`,
    });
    return;
  }

  await db.update(videosTable).set({
    renderStatus: "queued",
    renderResolution: resolution,
    aspectRatio,
    captionsEnabled,
    renderError: null,
    renderJobId: null,
    renderCompletedAt: null,
  }).where(eq(videosTable.id, videoId));

  startVideoRender(videoId, resolution, aspectRatio as AspectRatio, captionsEnabled);

  const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  res.json(updated);
});

// ── Get render status ─────────────────────────────────────────────────────────
router.get("/projects/:id/videos/:videoId/render", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);

  const [video] = await db.select().from(videosTable).where(
    and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId))
  );

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json({
    videoId: video.id,
    renderStatus: video.renderStatus,
    renderResolution: video.renderResolution,
    renderStartedAt: video.renderStartedAt,
    renderCompletedAt: video.renderCompletedAt,
    renderError: video.renderError,
    videoUrl: video.videoUrl,
    voiceoverUrl: video.voiceoverUrl,
  });
});

// ── Cancel / reset a stuck or in-progress render ─────────────────────────────
router.delete("/projects/:id/videos/:videoId/render", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);

  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  const [video] = await db.select().from(videosTable).where(
    and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId))
  );
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (video.renderStatus !== "queued" && video.renderStatus !== "processing") {
    res.status(409).json({ error: "No render in progress to cancel" });
    return;
  }

  await db.update(videosTable).set({
    renderStatus: "failed",
    renderError: "Render was cancelled.",
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));

  const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  res.json(updated);
});

export default router;
