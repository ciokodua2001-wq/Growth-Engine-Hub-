/**
 * Assembly routes - POST to start, GET to poll status.
 *
 * POST /projects/:id/videos/:videoId/assemble
 *   Accepts: { outputFormats, transitionType, transitionDuration, logoUrl,
 *              logoPosition, logoOpacity, backgroundMusicUrl, captionsEnabled,
 *              captionPreset, captionX, captionY, captionScale }
 *   Returns: { assemblyIds, assemblies[] }
 *
 *   Deduplication: if a "complete" assembly already exists for a requested format
 *   with the same options fingerprint, it is returned immediately without re-running
 *   FFmpeg - preventing redundant CPU/storage spend when users click assemble twice.
 *   This check runs even for force=true retries (button or client auto-retry), so a
 *   retry that races a genuinely slow-but-successful encode resolves instantly
 *   instead of burying the real result behind a second full re-encode.
 *
 * GET /projects/:id/videos/:videoId/assemblies
 *   Returns: { assemblies[], overallStatus, progress }
 *
 * GET /projects/:id/videos/:videoId/assemblies/:assemblyId
 *   Returns: { assembly }
 */

import { createHash, randomUUID } from "crypto";

// Bump whenever the caption layout/ASS renderer changes so cached captioned
// assemblies are invalidated and re-rendered with the new rules.
const CAPTION_RENDERER_VERSION = "v3-safe-area-wrap";
import { Readable } from "stream";
import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  videosTable,
  klingSceneJobsTable,
  commercialAssembliesTable,
  assetsTable,
} from "@workspace/db";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { objectStorageClient, signObjectURL } from "../lib/objectStorage.js";
import {
  getAssembler,
  checkAssemblerRequirements,
  type OutputFormat,
  type AssemblyOptions,
  type CaptionPreset,
} from "../lib/ffmpegAssembler.js";
import { compositeLogoOnVideo, compositeCaptionsOnVideo } from "../lib/ffmpegAssembler.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "assemble.route" });

// Re-sign a GCS signed URL with a fresh 24-hour TTL.
// Both scene videos (4-hour TTL) and assembled videos (24-hour TTL) can expire.
/**
 * Fetch a stored object, re-signing on a 403/404 before giving up.
 * Asset rows store presigned Wasabi URLs whose signature expires; reading them
 * verbatim (or signing once and racing a slow encode) produced intermittent
 * "Logo asset unavailable (403)" and the badge silently never appeared.
 */
async function fetchStoredObject(storedUrl: string, label: string): Promise<Buffer> {
  const attempt = async (): Promise<Response> =>
    fetch(await refreshAssemblyUrl(storedUrl), { signal: AbortSignal.timeout(20_000) });
  let first: Response;
  try { first = await attempt(); }
  catch (e) { throw new Error(`${label} fetch failed: ${e instanceof Error ? e.message : String(e)}`); }
  if (first.ok) return Buffer.from(await first.arrayBuffer());
  if (first.status === 403 || first.status === 404) {
    // Re-sign from scratch and retry once - a stale signature is indistinguishable
    // from a genuinely missing key until you ask again with fresh credentials.
    const second = await attempt();
    if (second.ok) return Buffer.from(await second.arrayBuffer());
    throw new Error(`${label} unavailable (${second.status})`);
  }
  throw new Error(`${label} unavailable (${first.status})`);
}

async function refreshAssemblyUrl(storedUrl: string): Promise<string> {
  if (!storedUrl || !storedUrl.startsWith("http")) return storedUrl;
  try {
    const u = new URL(storedUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return storedUrl;
    const bucketName = parts[0]!;
    const objectName = parts.slice(1).map(decodeURIComponent).join("/");
    return await signObjectURL({ bucketName, objectName, method: "GET", ttlSec: 86_400 });
  } catch {
    return storedUrl;
  }
}

const VALID_FORMATS: OutputFormat[] = ["landscape", "square", "vertical"];
const VALID_TRANSITIONS = ["fade", "dissolve", "wipeleft", "wiperight", "slideup", "slidedown"];
const VALID_POSITIONS = ["br", "bl", "tr", "tl"];

// This post-render operation uses FFmpeg on the completed assembly; it never invokes AI.
router.post("/projects/:id/videos/:videoId/assemblies/:assemblyId/logo", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = Number(req.params.id);
  const videoId = Number(req.params.videoId);
  const assemblyId = Number(req.params.assemblyId);
  const assetId = Number(req.body?.assetId);
  if (![projectId, videoId, assemblyId, assetId].every(Number.isSafeInteger)) {
    res.status(400).json({ error: "Invalid project, video, assembly, or logo asset ID" });
    return;
  }
  const [video] = await db.select({ id: videosTable.id }).from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  const [assembly] = await db.select().from(commercialAssembliesTable)
    .where(and(eq(commercialAssembliesTable.id, assemblyId), eq(commercialAssembliesTable.videoId, videoId), eq(commercialAssembliesTable.status, "complete")));
  if (!assembly?.videoUrl) { res.status(404).json({ error: "Completed video render not found" }); return; }
  const [asset] = await db.select().from(assetsTable)
    .where(and(eq(assetsTable.id, assetId), eq(assetsTable.projectId, projectId)));
  if (!asset?.url || asset.mimeType?.toLowerCase() !== "image/png") {
    res.status(422).json({ error: "Choose a PNG logo attached to this project" });
    return;
  }
  try {
    const logo = await fetchStoredObject(asset.url, "Logo asset");
    if (logo.length < 26 || logo.length > 10 * 1024 * 1024 ||
      !logo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      logo.toString("ascii", 12, 16) !== "IHDR" || ![4, 6].includes(logo[25]!)) {
      res.status(422).json({ error: "Choose a transparent PNG logo" });
      return;
    }
    const result = await compositeLogoOnVideo(await refreshAssemblyUrl(assembly.videoUrl), logo, {
      projectId,
      videoId,
      x: Number.isFinite(req.body?.x) ? Math.min(1, Math.max(0, req.body.x)) : 0.82,
      y: Number.isFinite(req.body?.y) ? Math.min(1, Math.max(0, req.body.y)) : 0.82,
      scale: Number.isFinite(req.body?.scale) ? Math.min(1, Math.max(0.02, req.body.scale)) : 0.2,
    });
    const [logoAssembly] = await db.insert(commercialAssembliesTable).values({
      videoId, outputFormat: assembly.outputFormat, status: "complete", videoUrl: result.url,
      durationSec: assembly.durationSec, fileSizeBytes: result.bytes,
      options: { postRenderLogo: { assetId, x: req.body?.x ?? 0.82, y: req.body?.y ?? 0.82, scale: req.body?.scale ?? 0.2 }, sourceAssemblyId: assemblyId, processing: "ffmpeg-only" },
      completedAt: new Date(),
    }).returning({ id: commercialAssembliesTable.id });
    res.json({ ...result, assemblyId: logoAssembly!.id, sourceAssemblyId: assemblyId, processing: "ffmpeg-only" });
  } catch (error) {
    logger.error({ projectId, videoId, assemblyId, assetId, error: error instanceof Error ? error.message : String(error) }, "[assemble] Post-render logo export failed");
    res.status(502).json({ error: "Could not export the video with this logo. Please try again." });
  }
});

async function resolveCompletedVideoUrl(projectId: number, videoId: number, storedUrl: string): Promise<string> {
  if (storedUrl.startsWith("grok-object://")) {
    const ref = storedUrl.slice("grok-object://".length);
    const slash = ref.indexOf("/");
    const bucketName = decodeURIComponent(ref.slice(0, slash));
    const objectName = ref.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
    if (slash <= 0 || bucketName !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || !objectName.startsWith(`commercial/grok/${videoId}/`)) {
      throw new Error("Stored video reference is invalid");
    }
    return signObjectURL({ bucketName, objectName, method: "GET", ttlSec: 300 });
  }
  if (storedUrl.startsWith("/api/projects/")) throw new Error("Unsupported video media URL");
  return refreshAssemblyUrl(storedUrl);
}

function hasPngTransparency(png: Buffer): boolean {
  if (png[25] === 4 || png[25] === 6) return true;
  if (png[25] !== 3) return false;
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    if (length > png.length - offset - 12) return false;
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") return true;
    if (type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

//
// ── POST /projects/:id/logo-assets ───────────────────────────────────────────
// Upload a transparent PNG logo directly into the project's asset library so
// the Post-render logo section never has to leave Commercial Studio. Multipart
// field name is "logo". Returns the created asset row (same shape as GET
// /projects/:id/assets) so the picker can select it immediately.
const logoAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/png$/i.test(file.mimetype) || /\.png$/i.test(file.originalname);
    if (!ok) { cb(new Error("Only transparent PNG logos are supported")); return; }
    cb(null, true);
  },
});

router.post(
  "/projects/:id/logo-assets",
  logoAssetUpload.single("logo"),
  async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const projectId = Number(req.params.id);
    if (!Number.isSafeInteger(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
    if (!req.file) { res.status(400).json({ error: "No PNG logo file provided" }); return; }

    const png = req.file.buffer;
    const isPng = png.length >= 26 &&
      png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      png.toString("ascii", 12, 16) === "IHDR" && [4, 6].includes(png[25]!);
    if (!isPng || !hasPngTransparency(png)) {
      res.status(422).json({ error: "Logo must be a transparent PNG (RGBA). Flattened JPEG/PNG backgrounds are rejected." });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) { res.status(503).json({ error: "Object storage not configured" }); return; }

    try {
      const safeName = req.file.originalname.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "logo.png";
      const objectName = `assets/project-${projectId}/logos/${randomUUID()}-${safeName}`;
      await objectStorageClient.bucket(bucketId).file(objectName).save(png, {
        metadata: { contentType: "image/png" },
      });
      const url = await signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 86_400 });
      const [asset] = await db.insert(assetsTable).values({
        projectId,
        type: "logo",
        name: safeName,
        url,
        mimeType: "image/png",
        fileSize: req.file.size,
      }).returning();
      logger.info({ projectId, assetId: asset!.id, bytes: req.file.size }, "[assemble] Logo asset uploaded from Commercial Studio");
      res.status(201).json({ ...asset, createdAt: asset!.createdAt.toISOString() });
    } catch (error) {
      logger.error({ projectId, error: error instanceof Error ? error.message : String(error) }, "[assemble] Logo asset upload failed");
      res.status(502).json({ error: "Could not store the logo. Please try again." });
    }
  },
);

// Serve a stored asset's bytes through the API server (re-signs the object URL
// on demand). The picker uses this for previews because the persisted signed
// URL in assets.url expires after 24 hours and would render a broken image.
router.get("/projects/:id/assets/:assetId/content", async (req, res) => {
  const projectId = Number(req.params.id);
  const assetId = Number(req.params.assetId);
  if (![projectId, assetId].every(Number.isSafeInteger)) { res.status(400).json({ error: "Invalid IDs" }); return; }
  const [asset] = await db.select().from(assetsTable)
    .where(and(eq(assetsTable.id, assetId), eq(assetsTable.projectId, projectId)));
  if (!asset?.url) { res.status(404).json({ error: "Asset not found" }); return; }
  try {
    const upstream = await fetch(await refreshAssemblyUrl(asset.url), { signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok) { res.status(502).json({ error: `Asset unavailable upstream (${upstream.status})` }); return; }
    res.setHeader("Content-Type", asset.mimeType ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (error) {
    logger.error({ assetId, error: error instanceof Error ? error.message : String(error) }, "[assemble] Asset content proxy failed");
    res.status(502).json({ error: "Could not load this asset" });
  }
});

// Primary Commercial Studio logo export path: apply a customer-supplied
// transparent PNG to an already completed render; no AI is called.
router.post("/projects/:id/videos/:videoId/logo", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = Number(req.params.id);
  const videoId = Number(req.params.videoId);
  const assetId = Number(req.body?.assetId);
  if (![projectId, videoId, assetId].every(Number.isSafeInteger)) {
    res.status(400).json({ error: "Invalid project, video, or logo asset ID" });
    return;
  }
  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  if (!video?.videoUrl || video.renderStatus !== "complete") {
    res.status(404).json({ error: "Completed video render not found" });
    return;
  }
  const [asset] = await db.select().from(assetsTable)
    .where(and(eq(assetsTable.id, assetId), eq(assetsTable.projectId, projectId)));
  if (!asset?.url || asset.mimeType?.toLowerCase() !== "image/png") {
    res.status(422).json({ error: "Choose a PNG logo attached to this project" });
    return;
  }
  if ((asset.fileSize ?? 0) > 10 * 1024 * 1024) {
    res.status(422).json({ error: "Logo file must be 10 MB or smaller" });
    return;
  }
  try {
    const declaredSize = asset.fileSize ?? 0;
    if (declaredSize > 10 * 1024 * 1024) {
      res.status(422).json({ error: "Logo file must be 10 MB or smaller" });
      return;
    }
    const logo = await fetchStoredObject(asset.url, "Logo asset");
    if (logo.length > 10 * 1024 * 1024) {
      res.status(422).json({ error: "Logo file must be 10 MB or smaller" });
      return;
    }
    if (logo.length < 26 || logo.length > 10 * 1024 * 1024 ||
      !logo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      logo.toString("ascii", 12, 16) !== "IHDR" || !hasPngTransparency(logo)) {
      res.status(422).json({ error: "Choose a transparent PNG logo under 10 MB" });
      return;
    }
    const result = await compositeLogoOnVideo(await resolveCompletedVideoUrl(projectId, videoId, video.videoUrl), logo, {
      projectId, videoId,
      x: typeof req.body?.x === "number" ? Math.min(1, Math.max(0, req.body.x)) : 0.82,
      y: typeof req.body?.y === "number" ? Math.min(1, Math.max(0, req.body.y)) : 0.82,
      scale: typeof req.body?.scale === "number" ? Math.min(1, Math.max(0.02, req.body.scale)) : 0.2,
    });
    const [exported] = await db.insert(commercialAssembliesTable).values({
      videoId,
      outputFormat: video.aspectRatio === "9:16" || video.aspectRatio === "4:5" ? "vertical" : video.aspectRatio === "1:1" ? "square" : "landscape",
      status: "complete", videoUrl: result.url, durationSec: video.duration == null ? null : String(video.duration),
      fileSizeBytes: result.bytes,
      options: { postRenderLogo: { assetId, x: req.body?.x ?? 0.82, y: req.body?.y ?? 0.82, scale: req.body?.scale ?? 0.2 }, processing: "ffmpeg-only" },
      completedAt: new Date(),
    }).returning({ id: commercialAssembliesTable.id });
    res.json({ ...result, assemblyId: exported!.id, sourceVideoId: videoId, processing: "ffmpeg-only" });
  } catch (error) {
    logger.error({ projectId, videoId, assetId, error: error instanceof Error ? error.message : String(error) }, "[assemble] Post-render logo export failed");
    res.status(502).json({ error: "Could not export the video with this logo. Please try again." });
  }
});

// Post-render caption burn-in: reviewed-transcript captions composited onto an
// already completed render via FFmpeg/libass. No AI is invoked, so caption
// placement/style/scale changes never incur model charges - they re-encode the
// existing MP4 exactly like the post-render logo pass.
const VALID_CAPTION_PRESETS = [
  "clean", "boldPop", "karaoke", "neonGlow", "cinematic", "gradientChip", "retroVHS", "socialBubble",
];

function parseCaptionOptions(body: Record<string, unknown>): { preset: CaptionPreset; x: number; y: number; scale: number } {
  const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    preset: VALID_CAPTION_PRESETS.includes(String(body.captionPreset ?? ""))
      ? (body.captionPreset as CaptionPreset)
      : "clean",
    x: clampNum(body.captionX, 0, 1, 0.5),
    y: clampNum(body.captionY, 0, 1, 0.85),
    scale: clampNum(body.captionScale, 0.25, 3.0, 1.0),
  };
}

function assertCaptionsReviewable(video: { transcriptStatus?: string | null; dialogueTranscript?: unknown }): string | null {
  const reviewed = (video.transcriptStatus === "ready" || video.transcriptStatus === "accepted")
    && Array.isArray(video.dialogueTranscript)
    && video.dialogueTranscript.length > 0;
  if (!reviewed) return "Captions require a reviewed transcript. Transcribe the actual audio and review/correct the transcript (including timing) before exporting captions.";
  const UNCLEAR_RE = /\[(?:unclear|inaudible|mumbled|\?)\]/i;
  const unclearCount = (video.dialogueTranscript as Array<{ text?: string }>).filter(s => UNCLEAR_RE.test(s?.text ?? "")).length;
  if (unclearCount > 0) return `${unclearCount} caption segment(s) contain uncertain transcription (marked [unclear]). Open the caption editor, replay the audio, and correct or accept the wording before exporting.`;
  return null;
}

// Primary caption path: burn reviewed-transcript captions onto the video's
// completed render. Mirrors POST /videos/:videoId/logo.
router.post("/projects/:id/videos/:videoId/captions", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = Number(req.params.id);
  const videoId = Number(req.params.videoId);
  if (![projectId, videoId].every(Number.isSafeInteger)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }
  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  if (!video?.videoUrl || video.renderStatus !== "complete") {
    res.status(404).json({ error: "Completed video render not found" });
    return;
  }
  const gate = assertCaptionsReviewable(video);
  if (gate) { res.status(422).json({ error: "Captions require a reviewed transcript", message: gate }); return; }
  const { preset, x, y, scale } = parseCaptionOptions((req.body ?? {}) as Record<string, unknown>);
  try {
    const result = await compositeCaptionsOnVideo(
      await resolveCompletedVideoUrl(projectId, videoId, video.videoUrl),
      video.dialogueTranscript as Parameters<typeof compositeCaptionsOnVideo>[1],
      { projectId, videoId, preset, x, y, scale },
    );
    const [exported] = await db.insert(commercialAssembliesTable).values({
      videoId,
      outputFormat: video.aspectRatio === "9:16" || video.aspectRatio === "4:5" ? "vertical" : video.aspectRatio === "1:1" ? "square" : "landscape",
      status: "complete", videoUrl: result.url, durationSec: video.duration == null ? null : String(video.duration),
      fileSizeBytes: result.bytes,
      options: { postRenderCaptions: { preset, x, y, scale }, processing: "ffmpeg-only" },
      completedAt: new Date(),
    }).returning({ id: commercialAssembliesTable.id });
    res.json({ ...result, assemblyId: exported!.id, sourceVideoId: videoId, processing: "ffmpeg-only" });
  } catch (error) {
    logger.error({ projectId, videoId, error: error instanceof Error ? error.message : String(error) }, "[assemble] Post-render caption export failed");
    res.status(502).json({ error: "Could not export the video with captions. Please try again." });
  }
});

// Chained caption path: burn captions onto an existing completed assembly so it
// composes with a post-render logo (apply logo, then captions, or vice versa).
router.post("/projects/:id/videos/:videoId/assemblies/:assemblyId/captions", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = Number(req.params.id);
  const videoId = Number(req.params.videoId);
  const assemblyId = Number(req.params.assemblyId);
  if (![projectId, videoId, assemblyId].every(Number.isSafeInteger)) {
    res.status(400).json({ error: "Invalid project, video, or assembly ID" });
    return;
  }
  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  const [assembly] = await db.select().from(commercialAssembliesTable)
    .where(and(eq(commercialAssembliesTable.id, assemblyId), eq(commercialAssembliesTable.videoId, videoId), eq(commercialAssembliesTable.status, "complete")));
  if (!assembly?.videoUrl) { res.status(404).json({ error: "Completed video render not found" }); return; }
  const gate = assertCaptionsReviewable(video);
  if (gate) { res.status(422).json({ error: "Captions require a reviewed transcript", message: gate }); return; }
  const { preset, x, y, scale } = parseCaptionOptions((req.body ?? {}) as Record<string, unknown>);
  try {
    const result = await compositeCaptionsOnVideo(
      await refreshAssemblyUrl(assembly.videoUrl),
      video.dialogueTranscript as Parameters<typeof compositeCaptionsOnVideo>[1],
      { projectId, videoId, preset, x, y, scale },
    );
    const [exported] = await db.insert(commercialAssembliesTable).values({
      videoId, outputFormat: assembly.outputFormat, status: "complete", videoUrl: result.url,
      durationSec: assembly.durationSec, fileSizeBytes: result.bytes,
      options: { postRenderCaptions: { preset, x, y, scale }, sourceAssemblyId: assemblyId, processing: "ffmpeg-only" },
      completedAt: new Date(),
    }).returning({ id: commercialAssembliesTable.id });
    res.json({ ...result, assemblyId: exported!.id, sourceAssemblyId: assemblyId, processing: "ffmpeg-only" });
  } catch (error) {
    logger.error({ projectId, videoId, assemblyId, error: error instanceof Error ? error.message : String(error) }, "[assemble] Post-render caption export failed");
    res.status(502).json({ error: "Could not export the video with captions. Please try again." });
  }
});

router.param("id", requireProjectOwnershipParam());

// ── POST /projects/:id/videos/:videoId/assemble ───────────────────────────────
router.post("/projects/:id/videos/:videoId/assemble", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  // ── Check requirements ──────────────────────────────────────────────────────
  const { ready, missing } = checkAssemblerRequirements();
  if (!ready) {
    // Full detail (may reference internal vendors/infra) stays server-side only.
    logger.error({ missing }, "[assemble] Assembly pipeline unavailable - missing configuration");
    res.status(503).json({
      error: "Video assembly is temporarily unavailable",
      message: "Please try again later or contact support if this persists.",
    });
    return;
  }

  // ── Verify video ownership ─────────────────────────────────────────────────
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // ── Validate scenes are all complete ──────────────────────────────────────
  const scenes = await db
    .select()
    .from(klingSceneJobsTable)
    .where(eq(klingSceneJobsTable.videoId, videoId))
    .orderBy(klingSceneJobsTable.sceneIndex);

  if (scenes.length === 0) {
    res.status(422).json({
      error: "No scenes available",
      message: "Generate scenes first using POST /scenes/generate",
    });
    return;
  }

  const notReady = scenes.filter(s => s.status !== "succeed");
  if (notReady.length > 0) {
    res.status(422).json({
      error: "Not all scenes are complete",
      message: `${notReady.length} scene(s) are not yet complete. All scenes must succeed before assembly.`,
      notReady: notReady.map(s => ({
        sceneIndex: s.sceneIndex,
        sceneName: s.sceneName,
        status: s.status,
      })),
    });
    return;
  }

  // ── Parse and validate options ─────────────────────────────────────────────
  const body = req.body as Record<string, unknown>;

  const requestedFormats: OutputFormat[] = Array.isArray(body.outputFormats)
    ? (body.outputFormats as string[]).filter((f): f is OutputFormat => VALID_FORMATS.includes(f as OutputFormat))
    : ["landscape"];

  if (requestedFormats.length === 0) {
    res.status(400).json({
      error: "Invalid outputFormats",
      valid: VALID_FORMATS,
      message: "Provide at least one valid output format: landscape, square, or vertical",
    });
    return;
  }

  const transitionType = VALID_TRANSITIONS.includes(String(body.transitionType ?? ""))
    ? String(body.transitionType)
    : "fade";

  const transitionDuration = typeof body.transitionDuration === "number"
    ? Math.min(Math.max(body.transitionDuration, 0.1), 1.5)
    : 0.5;

  const logoPosition = VALID_POSITIONS.includes(String(body.logoPosition ?? ""))
    ? String(body.logoPosition)
    : "br";

  const logoOpacity = typeof body.logoOpacity === "number"
    ? Math.min(Math.max(body.logoOpacity, 0), 1)
    : 0.85;

  // Caption burn-in is opt-in (default: false - clean MP4, browser overlay in UI).
  const captionsEnabled = body.captionsEnabled === true;

  // Captions must come from the REVIEWED actual-audio transcript. Never silently
  // substitute the approved script or per-scene narrationLine for the spoken
  // words. Require a transcript whose timing has been reviewed before burning.
  if (captionsEnabled) {
    const reviewed = (video.transcriptStatus === "ready" || video.transcriptStatus === "accepted")
      && Array.isArray(video.dialogueTranscript)
      && video.dialogueTranscript.length > 0;
    if (!reviewed) {
      res.status(422).json({
        error: "Captions require a reviewed transcript",
        message: "Transcribe the actual audio and review/correct the transcript (including timing) before exporting captions.",
      });
      return;
    }
    // Unresolved uncertain speech must never burn onto a finished video. A
    // segment marked [unclear]/[inaudible]/[mumbled]/[?] means the transcription
    // was not reliably understood - block the export until the customer corrects
    // or accepts it in the caption editor. This is the honesty guard: no silent
    // word substitution, no "[unclear]" burned into the final MP4.
    const UNCLEAR_RE = /\[(?:unclear|inaudible|mumbled|\?)\]/i;
    const unclearCount = (video.dialogueTranscript as Array<{ text?: string }> | null ?? []).filter(s => UNCLEAR_RE.test(s?.text ?? "")).length;
    if (unclearCount > 0) {
      res.status(422).json({
        error: "Unclear speech must be reviewed first",
        message: `${unclearCount} caption segment(s) contain uncertain transcription (marked [unclear]). Open the caption editor, replay the audio, and correct or accept the wording before exporting.`,
      });
      return;
    }
  }
  const VALID_CAPTION_PRESETS = [
    "clean", "boldPop", "karaoke", "neonGlow", "cinematic", "gradientChip", "retroVHS", "socialBubble",
  ];
  const captionPreset: CaptionPreset = VALID_CAPTION_PRESETS.includes(String(body.captionPreset ?? ""))
    ? (body.captionPreset as CaptionPreset)
    : "clean";

  // Free-form position (0-1, normalized to the full output frame - matches
  // the client's drag-box preview) and font/box scale. Clamped defensively
  // even though ffmpegAssembler.ts clamps again internally.
  const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const captionX = clampNum(body.captionX, 0, 1, 0.5);
  const captionY = clampNum(body.captionY, 0, 1, 0.85);
  const captionScale = clampNum(body.captionScale, 0.25, 3.0, 1.0);

  const options: AssemblyOptions = {
    outputFormats: requestedFormats,
    transitionType: transitionType as AssemblyOptions["transitionType"],
    transitionDuration,
    logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : undefined,
    logoPosition: logoPosition as AssemblyOptions["logoPosition"],
    logoOpacity,
    backgroundMusicUrl: typeof body.backgroundMusicUrl === "string" ? body.backgroundMusicUrl : undefined,
    captionsEnabled,
    captionPreset,
    captionX,
    captionY,
    captionScale,
  };

  // ── Options fingerprint - used for assembly deduplication ──────────────────
  // Dynamic URLs (logoUrl, musicUrl) are intentionally excluded - they are signed
  // URLs that change per-request even for the same asset.
  // captionsEnabled + style are included so clean and captioned renders coexist.
  const optionsFingerprint = createHash("sha256")
    .update(JSON.stringify({
      transitionType: options.transitionType,
      transitionDuration: options.transitionDuration,
      logoPosition: options.logoPosition,
      logoOpacity: options.logoOpacity,
      captionsEnabled,
      captionPreset: captionsEnabled ? captionPreset : null,
      captionX: captionsEnabled ? captionX : null,
      captionY: captionsEnabled ? captionY : null,
      captionScale: captionsEnabled ? captionScale : null,
      hasLogo: !!options.logoUrl,
      hasMusic: !!options.backgroundMusicUrl,
      // Invalidate the cache when the underlying material changes:
      // transcript text/timing, caption renderer version, or the source render.
      transcript: captionsEnabled ? video.dialogueTranscript : null,
      rendererVersion: CAPTION_RENDERER_VERSION,
      sourceVersion: video.renderCompletedAt?.toISOString()
        ?? video.renderStartedAt?.toISOString()
        ?? video.createdAt.toISOString(),
    }))
    .digest("hex");

  // ── Deduplication: check for existing complete assemblies ──────────────────
  // If a complete assembly exists for each requested format with the same options
  // fingerprint, return it immediately - no FFmpeg needed.
  //
  // Runs even when force=true. force is set both by the user-facing "Retry
  // Assembly" button AND by the client's silent auto-retry-on-timeout logic
  // (commercial-progress.tsx) - and that timeout is a client-side clock that
  // can race a genuinely slow-but-successful encode (this box's encode times
  // and the client's poll budget are close enough that this isn't rare). If
  // force unconditionally skipped this check, a race would spawn a fully
  // redundant re-encode AND - because GET /assemblies reports status from
  // the LATEST row per format - bury the assembly that had just succeeded
  // behind a brand new "processing" row, so the client waits through a
  // second full encode for a video it already had. Always checking first
  // makes retries idempotent against real completions: a genuinely stuck
  // job still gets a fresh attempt (nothing here is "complete" yet), but a
  // race against a real success now resolves instantly instead of doubling
  // the wait.
  type AssemblyRow = typeof commercialAssembliesTable.$inferSelect;
  const cachedByFormat = new Map<OutputFormat, AssemblyRow>();

  const existingAssemblies = await db
    .select()
    .from(commercialAssembliesTable)
    .where(
      and(
        eq(commercialAssembliesTable.videoId, videoId),
        eq(commercialAssembliesTable.status, "complete"),
        inArray(commercialAssembliesTable.outputFormat, requestedFormats),
      ),
    );

  // Build a map: format → existing complete assembly with matching fingerprint
  for (const a of existingAssemblies) {
    const opts = a.options as Record<string, unknown> | null;
    if (opts?.optionsFingerprint === optionsFingerprint) {
      cachedByFormat.set(a.outputFormat as OutputFormat, a);
    }
  }

  // Reuse in-flight (pending/processing) assemblies with the SAME fingerprint so
  // two concurrent identical requests don't cancel + re-queue a duplicate render.
  const inFlightByFormat = new Map<OutputFormat, AssemblyRow>();
  const inFlightAssemblies = await db
    .select()
    .from(commercialAssembliesTable)
    .where(
      and(
        eq(commercialAssembliesTable.videoId, videoId),
        inArray(commercialAssembliesTable.status, ["pending", "processing"]),
      ),
    );
  for (const a of inFlightAssemblies) {
    const opts = a.options as Record<string, unknown> | null;
    if (opts?.optionsFingerprint === optionsFingerprint) {
      inFlightByFormat.set(a.outputFormat as OutputFormat, a);
    }
  }
  const matchingInFlightIds = [...inFlightByFormat.values()].map(a => a.id);

  const formatsNeedingRender = requestedFormats.filter(f => !cachedByFormat.has(f) && !inFlightByFormat.has(f));
  const formatsServedFromCache = requestedFormats.filter(f => cachedByFormat.has(f));

  if (formatsServedFromCache.length > 0) {
    logger.info(
      { videoId, cached: formatsServedFromCache, toRender: formatsNeedingRender, optionsFingerprint: optionsFingerprint.slice(0, 8) },
      "[assemble] Returning cached assemblies for some formats",
    );
  }

  // If ALL formats are cached, skip FFmpeg entirely - but still cancel any
  // stuck pending/processing rows for this video so the polling status is clean.
  if (formatsNeedingRender.length === 0) {
    logger.info(
      { videoId, formats: requestedFormats },
      "[assemble] All formats already assembled with same options - returning cached",
    );
    await db
      .update(commercialAssembliesTable)
      .set({
        status: "cancelled",
        errorMessage: "Superseded by a completed assembly.",
        updatedAt: new Date(),
      } as unknown as typeof commercialAssembliesTable.$inferInsert)
      .where(
        and(
          eq(commercialAssembliesTable.videoId, videoId),
          inArray(commercialAssembliesTable.status, ["pending", "processing"]),
        ),
      );
    res.status(200).json({
      message: "Assemblies already complete - returning cached results",
      videoId,
      formats: requestedFormats,
      cached: true,
      assemblyIds: [...cachedByFormat.values(), ...inFlightByFormat.values()].map(a => a.id),
      assemblies: [...cachedByFormat.values(), ...inFlightByFormat.values()].map(formatAssembly),
    });
    return;
  }

  // ── Cancel any in-flight assemblies for this video (re-render request) ─────
  await db
    .update(commercialAssembliesTable)
    .set({ status: "cancelled" } as unknown as typeof commercialAssembliesTable.$inferInsert)
    .where(
      and(
        eq(commercialAssembliesTable.videoId, videoId),
        inArray(commercialAssembliesTable.status, ["pending", "processing"]),
        ...(matchingInFlightIds.length > 0
          ? [notInArray(commercialAssembliesTable.id, matchingInFlightIds)]
          : []),
      ),
    );

  // ── Create one assembly record per format that needs rendering ─────────────
  const assemblyRows = await db
    .insert(commercialAssembliesTable)
    .values(
      formatsNeedingRender.map(format => ({
        videoId,
        outputFormat: format,
        status: "pending" as const,
        // Store the fingerprint in options so future dedup checks can match it
        options: { ...options as unknown as Record<string, unknown>, optionsFingerprint },
      })),
    )
    .returning();

  const assemblyIds = assemblyRows.map(r => r.id);

  logger.info(
    { videoId, formats: formatsNeedingRender, assemblyIds, optionsFingerprint: optionsFingerprint.slice(0, 8) },
    "[assemble] Assembly jobs created - starting pipeline",
  );

  // Update video render status
  await db
    .update(videosTable)
    .set({ renderStatus: "processing", renderStartedAt: new Date(), renderError: null })
    .where(eq(videosTable.id, videoId));

  // Assembly pipeline. When the dedicated FFmpeg worker is enabled (default),
  // leave the new rows "pending" for the worker to atomically claim + assemble,
  // so CPU-heavy encodes never run inside the API process. The legacy in-process
  // path remains as a rollback escape hatch (FFMPEG_WORKER_MODE="false").
  if (process.env.FFMPEG_WORKER_MODE !== "false") {
    logger.info({ videoId, assemblyIds, formatsNeedingRender }, "[assemble] Queued for FFmpeg worker");
  } else {
    getAssembler()
      .assemble(videoId, assemblyIds, formatsNeedingRender, options)
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, videoId }, "[assemble] Pipeline unhandled error");
        void db
          .update(commercialAssembliesTable)
          .set({
            status: "failed",
            errorMessage: msg.slice(0, 1000),
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commercialAssembliesTable.videoId, videoId),
              inArray(commercialAssembliesTable.status, ["pending", "processing"]),
            ),
          );
        void db
          .update(videosTable)
          .set({ renderStatus: "failed", renderError: msg.slice(0, 500) })
          .where(eq(videosTable.id, videoId));
      });
  }

  // Include any cached assemblies in the response alongside the newly queued ones
  const allAssemblies = [
    ...assemblyRows.map(formatAssembly),
    ...[...cachedByFormat.values()].map(formatAssembly),
  ];

  res.status(202).json({
    message: "Assembly pipeline started",
    videoId,
    formats: requestedFormats,
    assemblyIds,
    cached: formatsServedFromCache,
    assemblies: allAssemblies,
    options: {
      transitionType,
      transitionDuration,
      captionsEnabled: options.captionsEnabled,
      hasLogo: !!options.logoUrl,
      hasMusic: !!options.backgroundMusicUrl,
    },
  });
});

// ── GET /projects/:id/videos/:videoId/assemblies ──────────────────────────────
router.get("/projects/:id/videos/:videoId/assemblies", async (req, res) => {
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

  const assemblies = await db
    .select()
    .from(commercialAssembliesTable)
    .where(eq(commercialAssembliesTable.videoId, videoId))
    .orderBy(commercialAssembliesTable.createdAt);

  // Compute overall status based on the LATEST assembly per format.
  // Earlier failed/cancelled rows from prior attempts are superseded and must
  // not drag the status back to "partial" when a later assembly succeeded.
  const latestByFormat = new Map<string, typeof assemblies[0]>();
  for (const a of assemblies) {
    const cur = latestByFormat.get(a.outputFormat);
    if (!cur || (a.createdAt ?? 0) >= (cur.createdAt ?? 0)) {
      latestByFormat.set(a.outputFormat, a);
    }
  }
  const relevant = [...latestByFormat.values()];

  const total = relevant.length;
  const complete = relevant.filter(a => a.status === "complete").length;
  const failed   = relevant.filter(a => a.status === "failed").length;
  const processing = relevant.filter(a => a.status === "pending" || a.status === "processing").length;

  let overallStatus: "idle" | "processing" | "complete" | "partial" | "failed";
  if (total === 0) overallStatus = "idle";
  else if (processing > 0) overallStatus = "processing";
  else if (failed === total) overallStatus = "failed";
  else if (complete === total) overallStatus = "complete";
  else overallStatus = "partial";

  // Re-sign any GCS videoUrls that may have expired (24-hour TTL).
  // Run all refreshes in parallel so it doesn't add latency per-assembly.
  const refreshedAssemblies = await Promise.all(
    assemblies.map(async a => {
      if (a.status === "complete" && a.videoUrl) {
        return { ...a, videoUrl: await refreshAssemblyUrl(a.videoUrl) };
      }
      return a;
    }),
  );

  res.json({
    videoId,
    overallStatus,
    progress: {
      total,
      complete,
      processing,
      failed,
      percentComplete: total > 0 ? Math.round((complete / total) * 100) : 0,
    },
    assemblies: refreshedAssemblies.map(formatAssembly),
  });
});

// ── GET /projects/:id/videos/:videoId/assemblies/:assemblyId ──────────────────
router.get("/projects/:id/videos/:videoId/assemblies/:assemblyId", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  const assemblyId = parseInt(req.params.assemblyId, 10);
  if (isNaN(projectId) || isNaN(videoId) || isNaN(assemblyId)) {
    res.status(400).json({ error: "Invalid ID" });
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

  const [assembly] = await db
    .select()
    .from(commercialAssembliesTable)
    .where(
      and(
        eq(commercialAssembliesTable.id, assemblyId),
        eq(commercialAssembliesTable.videoId, videoId),
      ),
    );

  if (!assembly) {
    res.status(404).json({ error: "Assembly not found" });
    return;
  }

  res.json({ assembly: formatAssembly(assembly) });
});

// ── POST /projects/:id/videos/:videoId/music ──────────────────────────────────
// Accepts a multipart audio upload (MP3 / WAV / AAC / M4A, max 80 MB),
// stores it in object storage, and returns a 24-hour signed URL that the
// frontend passes back as backgroundMusicUrl when starting assembly.

const musicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^audio\//i.test(file.mimetype) ||
      /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

router.post(
  "/projects/:id/videos/:videoId/music",
  musicUpload.single("music"),
  async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const projectId = parseInt(String(req.params.id), 10);
    const videoId   = parseInt(String(req.params.videoId), 10);
    if (isNaN(projectId) || isNaN(videoId)) {
      res.status(400).json({ error: "Invalid project or video ID" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      res.status(503).json({ error: "Object storage not configured" });
      return;
    }

    // Determine extension from original filename or MIME type
    const mimeExt: Record<string, string> = {
      "audio/mpeg": "mp3", "audio/mp3": "mp3",
      "audio/wav": "wav", "audio/x-wav": "wav",
      "audio/aac": "aac", "audio/m4a": "m4a",
      "audio/mp4": "m4a", "audio/ogg": "ogg",
      "audio/flac": "flac",
    };
    const ext = mimeExt[req.file.mimetype.toLowerCase()] ??
      req.file.originalname.split(".").pop()?.toLowerCase() ?? "mp3";

    const objectName = `renders/music/project-${projectId}/video-${videoId}-${randomUUID()}.${ext}`;
    const bucket = objectStorageClient.bucket(bucketId);
    await bucket.file(objectName).save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype || `audio/${ext}` },
    });

    const url = await signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 86_400 });
    res.json({ url, bytes: req.file.size, name: req.file.originalname });
  },
);

// ── GET /projects/:id/videos/:videoId/assemblies/:assemblyId/download ────────
// Proxy the assembled video through the API server with Content-Disposition: attachment.
// This forces a real file-save on mobile Chrome, which ignores the HTML `download`
// attribute on cross-origin GCS signed URLs.

router.get("/projects/:id/videos/:videoId/assemblies/:assemblyId/download", async (req, res) => {
  const projectId  = parseInt(req.params.id, 10);
  const videoId    = parseInt(req.params.videoId, 10);
  const assemblyId = parseInt(req.params.assemblyId, 10);
  if (isNaN(projectId) || isNaN(videoId) || isNaN(assemblyId)) {
    res.status(400).json({ error: "Invalid IDs" });
    return;
  }

  // Verify the video belongs to this project (ownership already checked via router.param)
  const [video] = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const [assembly] = await db
    .select({ videoUrl: commercialAssembliesTable.videoUrl })
    .from(commercialAssembliesTable)
    .where(and(
      eq(commercialAssembliesTable.id, assemblyId),
      eq(commercialAssembliesTable.videoId, videoId),
      eq(commercialAssembliesTable.status, "complete"),
    ));
  if (!assembly?.videoUrl) {
    res.status(404).json({ error: "Assembly not found or not complete" });
    return;
  }

  const signedUrl = await refreshAssemblyUrl(assembly.videoUrl);
  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    logger.warn({ err }, "[Download] Failed to fetch from GCS");
    res.status(502).json({ error: "Failed to fetch video from storage" });
    return;
  }
  if (!upstream.ok) {
    res.status(502).json({ error: `Storage returned ${upstream.status}` });
    return;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="commercial-${videoId}.mp4"`);
  res.setHeader("Cache-Control", "no-store");
  const cl = upstream.headers.get("content-length");
  if (cl) res.setHeader("Content-Length", cl);

  Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
});

// ── Response formatter ────────────────────────────────────────────────────────

function formatAssembly(a: typeof commercialAssembliesTable.$inferSelect) {
  return {
    id: a.id,
    videoId: a.videoId,
    outputFormat: a.outputFormat,
    status: a.status,
    videoUrl: a.videoUrl,
    durationSec: a.durationSec ? parseFloat(String(a.durationSec)) : null,
    fileSizeBytes: a.fileSizeBytes,
    errorMessage: a.errorMessage,
    options: a.options,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export default router;
