/**
 * Assembly routes — POST to start, GET to poll status.
 *
 * POST /projects/:id/videos/:videoId/assemble
 *   Accepts: { outputFormats, transitionType, transitionDuration, logoUrl,
 *              logoPosition, logoOpacity, backgroundMusicUrl, captionsEnabled }
 *   Returns: { assemblyIds, assemblies[] }
 *
 *   Deduplication: if a "complete" assembly already exists for a requested format
 *   with the same options fingerprint, it is returned immediately without re-running
 *   FFmpeg — preventing redundant CPU/storage spend when users click assemble twice.
 *
 * GET /projects/:id/videos/:videoId/assemblies
 *   Returns: { assemblies[], overallStatus, progress }
 *
 * GET /projects/:id/videos/:videoId/assemblies/:assemblyId
 *   Returns: { assembly }
 */

import { createHash, randomUUID } from "crypto";
import { Readable } from "stream";
import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  videosTable,
  klingSceneJobsTable,
  commercialAssembliesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { objectStorageClient, signObjectURL } from "../lib/objectStorage.js";
import {
  getAssembler,
  checkAssemblerRequirements,
  type OutputFormat,
  type AssemblyOptions,
  type CaptionPreset,
  type CaptionPosition,
} from "../lib/ffmpegAssembler.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "assemble.route" });

// Re-sign a GCS signed URL with a fresh 24-hour TTL.
// Both scene videos (4-hour TTL) and assembled videos (24-hour TTL) can expire.
async function refreshAssemblyUrl(storedUrl: string): Promise<string> {
  if (!storedUrl.startsWith("https://storage.googleapis.com/")) return storedUrl;
  try {
    const u = new URL(storedUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return storedUrl;
    const bucketName = parts[0]!;
    const objectName = parts.slice(1).join("/");
    return await signObjectURL({ bucketName, objectName, method: "GET", ttlSec: 86_400 });
  } catch {
    return storedUrl;
  }
}

const VALID_FORMATS: OutputFormat[] = ["landscape", "square", "vertical"];
const VALID_TRANSITIONS = ["fade", "dissolve", "wipeleft", "wiperight", "slideup", "slidedown"];
const VALID_POSITIONS = ["br", "bl", "tr", "tl"];

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
    logger.error({ missing }, "[assemble] Assembly pipeline unavailable — missing configuration");
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

  const forceReassemble = body.force === true;

  // Caption burn-in is opt-in (default: false — clean MP4, browser overlay in UI).
  const captionsEnabled = body.captionsEnabled === true;
  const VALID_CAPTION_PRESETS = ["classic", "box", "bold", "neon", "cinematic"];
  const VALID_CAPTION_POSITIONS = ["bottom", "middle", "top"];
  const captionPreset: CaptionPreset = VALID_CAPTION_PRESETS.includes(String(body.captionPreset ?? ""))
    ? (body.captionPreset as CaptionPreset)
    : "classic";
  const captionPosition: CaptionPosition = VALID_CAPTION_POSITIONS.includes(String(body.captionPosition ?? ""))
    ? (body.captionPosition as CaptionPosition)
    : "bottom";

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
    captionPosition,
  };

  // ── Options fingerprint — used for assembly deduplication ──────────────────
  // Dynamic URLs (logoUrl, musicUrl) are intentionally excluded — they are signed
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
      captionPosition: captionsEnabled ? captionPosition : null,
      hasLogo: !!options.logoUrl,
      hasMusic: !!options.backgroundMusicUrl,
    }))
    .digest("hex");

  // ── Deduplication: check for existing complete assemblies ──────────────────
  // If a complete assembly exists for each requested format with the same options
  // fingerprint, return it immediately — no FFmpeg needed.
  // Skip entirely when force=true (re-assemble request from the UI).
  type AssemblyRow = typeof commercialAssembliesTable.$inferSelect;
  const cachedByFormat = new Map<OutputFormat, AssemblyRow>();

  if (!forceReassemble) {
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
  }

  const formatsNeedingRender = requestedFormats.filter(f => !cachedByFormat.has(f));
  const formatsServedFromCache = requestedFormats.filter(f => cachedByFormat.has(f));

  if (formatsServedFromCache.length > 0) {
    logger.info(
      { videoId, cached: formatsServedFromCache, toRender: formatsNeedingRender, optionsFingerprint: optionsFingerprint.slice(0, 8) },
      "[assemble] Returning cached assemblies for some formats",
    );
  }

  // If ALL formats are cached, skip FFmpeg entirely — but still cancel any
  // stuck pending/processing rows for this video so the polling status is clean.
  if (formatsNeedingRender.length === 0) {
    logger.info(
      { videoId, formats: requestedFormats },
      "[assemble] All formats already assembled with same options — returning cached",
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
      message: "Assemblies already complete — returning cached results",
      videoId,
      formats: requestedFormats,
      cached: true,
      assemblyIds: [...cachedByFormat.values()].map(a => a.id),
      assemblies: [...cachedByFormat.values()].map(formatAssembly),
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
    "[assemble] Assembly jobs created — starting pipeline",
  );

  // Update video render status
  await db
    .update(videosTable)
    .set({ renderStatus: "processing", renderStartedAt: new Date(), renderError: null })
    .where(eq(videosTable.id, videoId));

  // Fire-and-forget assembly pipeline
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
