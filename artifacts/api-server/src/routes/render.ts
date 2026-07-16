import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { checkRenderRequirements, startVideoRender, type RenderMode, type RenderResolution } from "../lib/videoRenderPipeline.js";
import { Storage } from "@google-cloud/storage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

  const { mode = "footage", resolution = "1080p" } = req.body as {
    mode?: RenderMode;
    resolution?: RenderResolution;
  };

  const validModes = ["footage", "avatar", "combined"];
  const validResolutions = ["1080p", "4k"];
  if (!validModes.includes(mode)) {
    res.status(400).json({ error: `mode must be one of: ${validModes.join(", ")}` });
    return;
  }
  if (!validResolutions.includes(resolution)) {
    res.status(400).json({ error: `resolution must be one of: ${validResolutions.join(", ")}` });
    return;
  }

  // Verify video belongs to this project
  const [video] = await db.select().from(videosTable).where(
    and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId))
  );
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // Block renders already in progress
  if (video.renderStatus === "queued" || video.renderStatus === "processing") {
    res.status(409).json({ error: "A render is already in progress for this video" });
    return;
  }

  // Avatar mode needs a photo
  if ((mode === "avatar" || mode === "combined") && !video.avatarPhotoPath) {
    res.status(422).json({ error: "Avatar photo must be uploaded before rendering in avatar or combined mode" });
    return;
  }

  // Check render service API keys
  const { ready, missing } = checkRenderRequirements();
  if (!ready) {
    res.status(503).json({
      error: "Video rendering is not yet configured",
      missing,
      message: `Set the following environment variables to enable video rendering: ${missing.join(", ")}`,
    });
    return;
  }

  // Mark queued immediately so polling works
  await db.update(videosTable).set({
    renderStatus: "queued",
    renderMode: mode,
    renderResolution: resolution,
    renderError: null,
    renderJobId: null,
    renderCompletedAt: null,
  }).where(eq(videosTable.id, videoId));

  // Fire and forget — pipeline runs in background
  startVideoRender(videoId, mode, resolution, video.avatarPhotoPath);

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
    renderMode: video.renderMode,
    renderResolution: video.renderResolution,
    renderStartedAt: video.renderStartedAt,
    renderCompletedAt: video.renderCompletedAt,
    renderError: video.renderError,
    videoUrl: video.videoUrl,
    voiceoverUrl: video.voiceoverUrl,
  });
});

// ── Upload avatar photo ───────────────────────────────────────────────────────
router.post(
  "/projects/:id/videos/:videoId/avatar",
  upload.single("photo"),
  async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const projectId = parseInt(String(req.params.id ?? ""), 10);
    const videoId = parseInt(String(req.params.videoId ?? ""), 10);

    if (!req.file) {
      res.status(400).json({ error: "No photo file uploaded" });
      return;
    }

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      res.status(400).json({ error: "Photo must be JPEG, PNG, or WebP" });
      return;
    }

    const [video] = await db.select().from(videosTable).where(
      and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId))
    );
    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      res.status(503).json({ error: "Object storage not configured" });
      return;
    }

    const ext = req.file.mimetype.split("/")[1] ?? "jpg";
    const objectPath = `avatars/project-${projectId}/video-${videoId}-${Date.now()}.${ext}`;

    const storage = new Storage();
    const bucket = storage.bucket(bucketId);
    const file = bucket.file(objectPath);

    await file.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
    });
    await file.makePublic();

    const [metadata] = await file.getMetadata();
    const publicUrl = metadata.mediaLink as string;

    await db.update(videosTable).set({ avatarPhotoPath: publicUrl }).where(eq(videosTable.id, videoId));

    const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
    res.json({ avatarPhotoPath: publicUrl, video: updated });
  }
);

export default router;
