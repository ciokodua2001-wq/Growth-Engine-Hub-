/**
 * Assembly routes — POST to start, GET to poll status.
 *
 * POST /projects/:id/videos/:videoId/assemble
 *   Accepts: { outputFormats, transitionType, transitionDuration, logoUrl,
 *              logoPosition, logoOpacity, backgroundMusicUrl, narrationUrl,
 *              captionsEnabled }
 *   Returns: { assemblyIds, assemblies[] }
 *
 * GET /projects/:id/videos/:videoId/assemblies
 *   Returns: { assemblies[], overallStatus, progress }
 *
 * GET /projects/:id/videos/:videoId/assemblies/:assemblyId
 *   Returns: { assembly }
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  videosTable,
  klingSceneJobsTable,
  commercialAssembliesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import {
  getAssembler,
  checkAssemblerRequirements,
  type OutputFormat,
  type AssemblyOptions,
} from "../lib/ffmpegAssembler.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "assemble.route" });

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
    res.status(503).json({
      error: "Assembly pipeline is not configured",
      missing,
      message: `Set these environment variables to enable assembly: ${missing.join(", ")}`,
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

  const options: AssemblyOptions = {
    outputFormats: requestedFormats,
    transitionType: transitionType as AssemblyOptions["transitionType"],
    transitionDuration,
    logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : undefined,
    logoPosition: logoPosition as AssemblyOptions["logoPosition"],
    logoOpacity,
    backgroundMusicUrl: typeof body.backgroundMusicUrl === "string" ? body.backgroundMusicUrl : undefined,
    narrationUrl: typeof body.narrationUrl === "string" ? body.narrationUrl : undefined,
    captionsEnabled: body.captionsEnabled !== false,
  };

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

  // ── Create one assembly record per requested format ────────────────────────
  const assemblyRows = await db
    .insert(commercialAssembliesTable)
    .values(
      requestedFormats.map(format => ({
        videoId,
        outputFormat: format,
        status: "pending" as const,
        options: options as unknown as Record<string, unknown>,
      })),
    )
    .returning();

  const assemblyIds = assemblyRows.map(r => r.id);

  logger.info(
    { videoId, formats: requestedFormats, assemblyIds },
    "[assemble] Assembly jobs created — starting pipeline",
  );

  // Update video render status
  await db
    .update(videosTable)
    .set({ renderStatus: "processing", renderStartedAt: new Date(), renderError: null })
    .where(eq(videosTable.id, videoId));

  // Fire-and-forget assembly pipeline
  getAssembler()
    .assemble(videoId, assemblyIds, requestedFormats, options)
    .catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, videoId }, "[assemble] Pipeline unhandled error");
      // Mark all pending assemblies as failed
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

  res.status(202).json({
    message: "Assembly pipeline started",
    videoId,
    formats: requestedFormats,
    assemblyIds,
    assemblies: assemblyRows.map(formatAssembly),
    options: {
      transitionType,
      transitionDuration,
      captionsEnabled: options.captionsEnabled,
      hasLogo: !!options.logoUrl,
      hasNarration: !!options.narrationUrl,
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

  const statusCounts = assemblies.reduce(
    (acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>,
  );

  const total = assemblies.length;
  const complete = statusCounts["complete"] ?? 0;
  const failed = statusCounts["failed"] ?? 0;
  const processing = (statusCounts["pending"] ?? 0) + (statusCounts["processing"] ?? 0);

  let overallStatus: "idle" | "processing" | "complete" | "partial" | "failed";
  if (total === 0) overallStatus = "idle";
  else if (processing > 0) overallStatus = "processing";
  else if (failed === total) overallStatus = "failed";
  else if (complete === total) overallStatus = "complete";
  else overallStatus = "partial";

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
    assemblies: assemblies.map(formatAssembly),
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
