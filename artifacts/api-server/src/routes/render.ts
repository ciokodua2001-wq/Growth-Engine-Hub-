import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { videosTable, projectAvatarsTable, platformAvatarsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { checkRenderRequirements, startVideoRender, type RenderMode, type RenderResolution, type AspectRatio } from "../lib/videoRenderPipeline.js";
import { objectStorageClient } from "../lib/objectStorage.js";

// Convert a relative proxy URL to absolute so external services (HeyGen) can fetch it.
function toAbsoluteUrl(url: string): string {
  if (!url.startsWith("/")) return url; // already absolute
  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
  const host = domains[0] ?? process.env.REPLIT_DEV_DOMAIN ?? "";
  return host ? `https://${host}${url}` : url;
}

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

  const {
    mode = "combined",
    resolution = "1080p",
    avatarId,
    platformAvatarId,
    aspectRatio = "16:9",
    captionsEnabled = false,
  } = req.body as {
    mode?: RenderMode;
    resolution?: RenderResolution;
    avatarId?: number;
    platformAvatarId?: number;
    aspectRatio?: string;
    captionsEnabled?: boolean;
  };

  const validModes = ["footage", "avatar", "combined"];
  const validResolutions = ["1080p", "4k"];
  const validAspectRatios = ["16:9", "9:16", "1:1", "4:5"];
  if (!validModes.includes(mode)) {
    res.status(400).json({ error: `mode must be one of: ${validModes.join(", ")}` });
    return;
  }
  if (!validResolutions.includes(resolution)) {
    res.status(400).json({ error: `resolution must be one of: ${validResolutions.join(", ")}` });
    return;
  }
  if (!validAspectRatios.includes(aspectRatio)) {
    res.status(400).json({ error: `aspectRatio must be one of: ${validAspectRatios.join(", ")}` });
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

  // Resolve avatar photo for avatar/combined modes.
  // Priority: platformAvatarId > avatarId (project library) > video.avatarPhotoPath > HeyGen default
  let resolvedAvatarPath: string | null = null;
  let resolvedAvatarInstructions: string | null = null;
  let resolvedPlatformAvatarId: number | null = null;
  let resolvedHeygenTalkingPhotoId: string | null = null;

  if (mode === "avatar" || mode === "combined") {
    if (platformAvatarId) {
      const [platformAvatar] = await db
        .select()
        .from(platformAvatarsTable)
        .where(and(eq(platformAvatarsTable.id, platformAvatarId), eq(platformAvatarsTable.isActive, true)));
      if (!platformAvatar) {
        res.status(404).json({ error: "Platform avatar not found" });
        return;
      }
      resolvedPlatformAvatarId = platformAvatar.id;
      if (platformAvatar.heygenTalkingPhotoId) {
        resolvedHeygenTalkingPhotoId = platformAvatar.heygenTalkingPhotoId;
      } else {
        // Pass the stored proxy URL as-is; videoRenderPipeline reads GCS directly
        resolvedAvatarPath = platformAvatar.previewUrl;
      }
    } else if (avatarId) {
      const [avatar] = await db
        .select()
        .from(projectAvatarsTable)
        .where(and(eq(projectAvatarsTable.id, avatarId), eq(projectAvatarsTable.projectId, projectId)));
      if (!avatar) {
        res.status(404).json({ error: "Avatar not found in project library" });
        return;
      }
      resolvedAvatarPath = avatar.photoUrl;
      resolvedAvatarInstructions = avatar.instructions;
    } else if (video.avatarPhotoPath) {
      resolvedAvatarPath = video.avatarPhotoPath;
    }
    // No photo → null is intentional; pipeline will use HeyGen default avatar
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

  // Mark queued immediately so polling works; persist aspect ratio + caption settings
  await db.update(videosTable).set({
    renderStatus: "queued",
    renderMode: mode,
    renderResolution: resolution,
    aspectRatio,
    captionsEnabled,
    renderError: null,
    renderJobId: null,
    renderCompletedAt: null,
  }).where(eq(videosTable.id, videoId));

  // Fire and forget — pipeline runs in background
  startVideoRender(videoId, mode, resolution, resolvedAvatarPath, resolvedAvatarInstructions, aspectRatio as AspectRatio, captionsEnabled, resolvedPlatformAvatarId, resolvedHeygenTalkingPhotoId);

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

    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(objectPath);

    await file.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
    });
    // No makePublic() — bucket has public access prevention enforced.
    // Store a relative proxy URL; render pipeline resolves it to absolute via toAbsoluteUrl().
    const proxyUrl = `/api/platform-avatars/photo?key=${encodeURIComponent(objectPath)}&bucket=${encodeURIComponent(bucketId)}`;

    await db.update(videosTable).set({ avatarPhotoPath: proxyUrl }).where(eq(videosTable.id, videoId));

    const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
    res.json({ avatarPhotoPath: proxyUrl, video: updated });
  }
);

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
