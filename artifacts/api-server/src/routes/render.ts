import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { signObjectURL } from "../lib/objectStorage.js";
import { GROK_STORAGE_REFERENCE_PREFIX } from "../lib/grokRenderer.js";
import { checkRenderRequirements, checkGrokRenderRequirements, startVideoRender, type RenderResolution, type AspectRatio } from "../lib/videoRenderPipeline.js";
import { checkVideoSeconds, reserveVideoSeconds } from "../lib/videoWallet.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "render.route" });

router.param("id", requireProjectOwnershipParam());

// Generic readiness check; never expose provider identity or production costs.
router.get("/video-render-capabilities", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const [user] = await db.select({ isOwner: usersTable.isOwner }).from(usersTable).where(eq(usersTable.id, userId));
  const rate = Number(process.env.GROK_VIDEO_COST_PER_SECOND_USD);
  const configured = checkGrokRenderRequirements().ready && Number.isFinite(rate) && rate > 0;
  res.setHeader("Cache-Control", "no-store");
  res.json({ enabled: configured && user?.isOwner === true });
});

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

  const requestedProvider = (req.body as { provider?: unknown } | undefined)?.provider;
  if (requestedProvider !== undefined && requestedProvider !== "grok") {
    res.status(400).json({ error: "The requested video production option is unavailable." });
    return;
  }
  const provider = "grok" as const;

  const {
    resolution     = "1080p",
    aspectRatio    = "16:9",
    captionsEnabled = false,
  } = req.body as {
    resolution?: RenderResolution;
    aspectRatio?: string;
    captionsEnabled?: boolean;
  };
  const validResolutions: RenderResolution[] = ["1080p", "4k"];
  const validAspectRatios: AspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
  if (!validResolutions.includes(resolution)) {
    res.status(400).json({ error: `resolution must be one of: ${validResolutions.join(", ")}` });
    return;
  }
  if (!validAspectRatios.includes(aspectRatio as AspectRatio)) {
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

  if (provider === "grok") {
    const [user] = await db.select({ isOwner: usersTable.isOwner }).from(usersTable).where(eq(usersTable.id, userId));
    const rate = Number(process.env.GROK_VIDEO_COST_PER_SECOND_USD);
    if (user?.isOwner !== true) {
      res.status(403).json({ error: "Video production is temporarily unavailable for this account." });
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      res.status(503).json({ error: "Video rendering is temporarily unavailable", message: "Please try again later or contact support if this persists." });
      return;
    }
  }

  const { ready, missing } = provider === "grok" ? checkGrokRenderRequirements() : checkRenderRequirements();
  if (!ready) {
    // Full detail (may reference internal vendors/infra) stays server-side only.
    logger.error({ missing }, "[render] Video rendering unavailable - missing configuration");
    res.status(503).json({
      error: "Video rendering is temporarily unavailable",
      message: "Please try again later or contact support if this persists.",
    });
    return;
  }

  // ── Video seconds wallet check ────────────────────────────────────────────
  const [user] = await db
    .select({ plan: usersTable.plan })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const plan            = user?.plan ?? "trial";
  // Grok generates a single clip capped at 15 seconds; check its billable duration.
  const requiredSeconds = provider === "grok" ? Math.min(15, Math.max(1, video.duration ?? 15)) : video.duration ?? 60;

  const { allowed, balance, message } = await checkVideoSeconds(userId, plan, requiredSeconds);
  if (!allowed) {
    res.status(402).json({
      error:             "Insufficient video seconds",
      message:           message ?? "You do not have enough video seconds to render this video.",
      requiredSeconds,
      remainingSeconds:  balance.totalRemaining,
      monthlyRemaining:  balance.monthlySecondsRemaining,
      purchasedRemaining: balance.purchasedSecondsRemaining,
    });
    return;
  }

  // Atomic claim prevents concurrent submissions from starting two paid jobs.
  const claimed = await db.update(videosTable).set({
    renderStatus:       "queued",
    renderResolution:   resolution,
    aspectRatio,
    captionsEnabled,
    renderError:        null,
    renderJobId:        null,
    renderCompletedAt:  null,
  }).where(and(
    eq(videosTable.id, videoId),
    sql`${videosTable.renderStatus} NOT IN ('queued', 'processing')`,
  )).returning({ id: videosTable.id });
  if (claimed.length === 0) {
    res.status(409).json({ error: "A render is already in progress for this video" });
    return;
  }

  if (provider === "grok") {
    const reserved = await reserveVideoSeconds(
      userId, requiredSeconds, videoId, projectId,
      `Grok video render reservation - "${video.title}"`,
      plan,
    );
    if (!reserved) {
      await db.update(videosTable).set({ renderStatus: "idle" }).where(and(
        eq(videosTable.id, videoId), eq(videosTable.renderStatus, "queued"),
      ));
      res.status(402).json({
        error: "Insufficient video seconds",
        message: "Your available video seconds were used by another generation. Refresh your balance and try again.",
        requiredSeconds,
      });
      return;
    }
  }

  startVideoRender(videoId, resolution, aspectRatio as AspectRatio, captionsEnabled, provider);

  const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  res.json(updated);
});

// ── Get render status ─────────────────────────────────────────────────────────
router.get("/projects/:id/videos/:videoId/render", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId   = parseInt(req.params.videoId, 10);

  const [video] = await db.select().from(videosTable).where(
    and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId))
  );

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json({
    videoId:           video.id,
    renderStatus:      video.renderStatus,
    renderResolution:  video.renderResolution,
    renderStartedAt:   video.renderStartedAt,
    renderCompletedAt: video.renderCompletedAt,
    renderError:       video.renderError,
    videoUrl:          video.videoUrl?.startsWith(GROK_STORAGE_REFERENCE_PREFIX)
      ? `/api/projects/${projectId}/videos/${videoId}/media`
      : video.videoUrl,
    voiceoverUrl:      video.voiceoverUrl,
  });
});

// Authenticated stable media URL for Grok objects. Streaming through the API
// means the client URL remains valid after the short-lived S3 presign expires.
router.get("/projects/:id/videos/:videoId/media", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = Number.parseInt(req.params.id, 10);
  const videoId = Number.parseInt(req.params.videoId, 10);
  if (!Number.isInteger(projectId) || !Number.isInteger(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }
  const [video] = await db.select().from(videosTable).where(and(
    eq(videosTable.id, videoId), eq(videosTable.projectId, projectId),
  ));
  if (!video || video.renderStatus !== "complete" || !video.videoUrl?.startsWith(GROK_STORAGE_REFERENCE_PREFIX)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const storedRef = video.videoUrl.slice(GROK_STORAGE_REFERENCE_PREFIX.length);
  const slash = storedRef.indexOf("/");
  if (slash <= 0) { res.status(404).json({ error: "Video not found" }); return; }
  const bucket = decodeURIComponent(storedRef.slice(0, slash));
  const key = storedRef.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
  if (bucket !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || !key.startsWith(`commercial/grok/${videoId}/`)) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  try {
    const url = await signObjectURL({ bucketName: bucket, objectName: key, method: "GET", ttlSec: 300 });
    const range = req.headers.range;
    const upstream = await fetch(url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status === 404 ? 404 : 502).json({ error: "Stored video is temporarily unavailable" });
      return;
    }
    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", 'inline; filename="growthforge-commercial.mp4"');
    if (upstream.body) {
      const { Readable } = await import("stream");
      Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
    } else res.end();
  } catch (error) {
    logger.error({ err: error, projectId, videoId }, "Grok video stream failed");
    if (!res.headersSent) res.status(502).json({ error: "Stored video is temporarily unavailable" });
    else res.end();
  }
});

// ── Cancel / reset a stuck or in-progress render ─────────────────────────────
router.delete("/projects/:id/videos/:videoId/render", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId   = parseInt(req.params.videoId, 10);

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
    renderStatus:      "failed",
    renderError:       "Render was cancelled.",
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));

  const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  res.json(updated);
});

export default router;
