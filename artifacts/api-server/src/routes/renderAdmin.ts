/**
 * Render administration endpoints — monitoring and operational controls.
 *
 * All endpoints require admin authentication.
 *
 * GET  /admin/render/metrics      — live queue + DB status snapshot
 * GET  /admin/render/queue        — queue metrics only
 * GET  /admin/render/stuck        — scenes stuck in submitted/processing
 * POST /admin/render/recover      — trigger manual stuck-scene recovery
 * GET  /admin/render/scenes       — paginated scene job listing (filter by status)
 * GET  /admin/render/assemblies   — paginated assembly listing (filter by status)
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { klingSceneJobsTable, commercialAssembliesTable, usersTable } from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import pino from "pino";
import { getRenderQueue } from "../lib/renderQueue.js";
import { getRenderMetrics, recoverStuckScenes } from "../lib/renderMonitor.js";

const router = Router();
const logger = pino({ name: "renderAdmin.route" });

// ── Admin guard ───────────────────────────────────────────────────────────────

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// ── GET /admin/render/metrics ─────────────────────────────────────────────────
router.get("/admin/render/metrics", requireAdmin, async (_req, res) => {
  try {
    const metrics = await getRenderMetrics();
    res.json(metrics);
  } catch (err) {
    logger.error({ err }, "[renderAdmin] Failed to fetch metrics");
    res.status(500).json({ error: "Failed to fetch render metrics" });
  }
});

// ── GET /admin/render/queue ───────────────────────────────────────────────────
router.get("/admin/render/queue", requireAdmin, (_req, res) => {
  res.json(getRenderQueue().getMetrics());
});

// ── GET /admin/render/stuck ───────────────────────────────────────────────────
router.get("/admin/render/stuck", requireAdmin, async (_req, res) => {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stuck = await db
      .select()
      .from(klingSceneJobsTable)
      .where(
        and(
          inArray(klingSceneJobsTable.status, ["submitted", "processing"]),
          sql`${klingSceneJobsTable.updatedAt} < ${cutoff}`,
        ),
      )
      .orderBy(desc(klingSceneJobsTable.updatedAt));

    res.json({
      count: stuck.length,
      cutoffMinutes: 30,
      scenes: stuck.map(s => ({
        id: s.id,
        videoId: s.videoId,
        sceneIndex: s.sceneIndex,
        sceneName: s.sceneName,
        status: s.status,
        klingTaskId: s.klingTaskId,
        retryCount: s.retryCount,
        updatedAt: s.updatedAt,
        stuckForMinutes: Math.round((Date.now() - new Date(s.updatedAt).getTime()) / 60_000),
      })),
    });
  } catch (err) {
    logger.error({ err }, "[renderAdmin] Failed to fetch stuck scenes");
    res.status(500).json({ error: "Failed to fetch stuck scenes" });
  }
});

// ── POST /admin/render/recover ────────────────────────────────────────────────
router.post("/admin/render/recover", requireAdmin, async (_req, res) => {
  logger.info("[renderAdmin] Manual recovery triggered");
  try {
    const result = await recoverStuckScenes();
    logger.info(result, "[renderAdmin] Manual recovery complete");
    res.json({ message: "Recovery complete", ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[renderAdmin] Manual recovery failed");
    res.status(500).json({ error: "Recovery failed", detail: msg });
  }
});

// ── GET /admin/render/scenes ──────────────────────────────────────────────────
router.get("/admin/render/scenes", requireAdmin, async (req, res) => {
  try {
    const validStatuses = ["pending", "submitted", "processing", "succeed", "failed"];
    const statusFilter = typeof req.query.status === "string" && validStatuses.includes(req.query.status)
      ? req.query.status
      : null;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10), 0);

    const scenes = statusFilter
      ? await db.select().from(klingSceneJobsTable)
          .where(eq(klingSceneJobsTable.status, statusFilter))
          .orderBy(desc(klingSceneJobsTable.updatedAt)).limit(limit).offset(offset)
      : await db.select().from(klingSceneJobsTable)
          .orderBy(desc(klingSceneJobsTable.updatedAt)).limit(limit).offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(klingSceneJobsTable)
      .where(statusFilter ? eq(klingSceneJobsTable.status, statusFilter) : sql`1=1`);

    res.json({
      total: total ?? 0,
      limit,
      offset,
      scenes: scenes.map(s => ({
        id: s.id,
        videoId: s.videoId,
        sceneIndex: s.sceneIndex,
        sceneName: s.sceneName,
        sceneType: s.sceneType,
        status: s.status,
        retryCount: s.retryCount,
        errorMessage: s.errorMessage,
        klingTaskId: s.klingTaskId,
        promptHash: s.promptHash,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[renderAdmin] Failed to list scenes");
    res.status(500).json({ error: "Failed to list scenes" });
  }
});

// ── GET /admin/render/assemblies ──────────────────────────────────────────────
router.get("/admin/render/assemblies", requireAdmin, async (req, res) => {
  try {
    const validStatuses = ["pending", "processing", "complete", "failed"];
    const statusFilter = typeof req.query.status === "string" && validStatuses.includes(req.query.status)
      ? req.query.status
      : null;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10), 0);

    const assemblies = statusFilter
      ? await db.select().from(commercialAssembliesTable)
          .where(eq(commercialAssembliesTable.status, statusFilter))
          .orderBy(desc(commercialAssembliesTable.updatedAt)).limit(limit).offset(offset)
      : await db.select().from(commercialAssembliesTable)
          .orderBy(desc(commercialAssembliesTable.updatedAt)).limit(limit).offset(offset);

    res.json({
      limit,
      offset,
      assemblies: assemblies.map(a => ({
        id: a.id,
        videoId: a.videoId,
        outputFormat: a.outputFormat,
        status: a.status,
        errorMessage: a.errorMessage,
        fileSizeBytes: a.fileSizeBytes,
        durationSec: a.durationSec,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        updatedAt: a.updatedAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[renderAdmin] Failed to list assemblies");
    res.status(500).json({ error: "Failed to list assemblies" });
  }
});

export default router;
