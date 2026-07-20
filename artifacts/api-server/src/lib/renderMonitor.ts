/**
 * RenderMonitor — background service that keeps commercial render jobs healthy.
 *
 * Responsibilities:
 *   1. Stuck scene recovery — find scenes that have been in "submitted" or
 *      "processing" longer than their expected timeout and reset them to
 *      "pending" so the next polling cycle re-queues them.
 *   2. Orphaned scene reprocessing — after a server restart, scenes that were
 *      mid-flight (submitted to Kling) get their polling loop resumed.
 *   3. Periodic metrics logging — aggregated counts for observability.
 *
 * Runs on a configurable interval (default: 5 min).
 * Called once from index.ts after the server starts listening.
 */

import pino from "pino";
import { db } from "@workspace/db";
import { klingSceneJobsTable } from "@workspace/db";
import { eq, lt, and, inArray, sql } from "drizzle-orm";
import { getRenderQueue } from "./renderQueue.js";

const logger = pino({ name: "renderMonitor" });

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Scenes "submitted" but not moved to "processing" within this window are stuck. */
const STUCK_SUBMITTED_MS = 35 * 60 * 1000; // 35 min

/**
 * Scenes in "processing" beyond this window have exceeded Kling's normal
 * generation window and should be reset for retry.
 */
const STUCK_PROCESSING_MS = 50 * 60 * 1000; // 50 min

/** Max retries per scene — beyond this, leave in failed and don't auto-recover. */
const MAX_AUTO_RECOVERY_RETRIES = 2;

/** Monitor interval. */
const MONITOR_INTERVAL_MS = parseInt(process.env.RENDER_MONITOR_INTERVAL_MS ?? "300000", 10); // 5 min

// ── Recovery logic ────────────────────────────────────────────────────────────

export interface RecoveryResult {
  stuckSubmitted: number;
  stuckProcessing: number;
  totalReset: number;
  timestamp: string;
}

export async function recoverStuckScenes(): Promise<RecoveryResult> {
  const now = new Date();
  const submittedCutoff = new Date(now.getTime() - STUCK_SUBMITTED_MS);
  const processingCutoff = new Date(now.getTime() - STUCK_PROCESSING_MS);

  logger.info(
    { submittedCutoff, processingCutoff },
    "[RenderMonitor] Scanning for stuck scenes",
  );

  // Find scenes stuck in "submitted" (never started processing)
  const stuckSubmitted = await db
    .select({ id: klingSceneJobsTable.id, videoId: klingSceneJobsTable.videoId, retryCount: klingSceneJobsTable.retryCount })
    .from(klingSceneJobsTable)
    .where(
      and(
        eq(klingSceneJobsTable.status, "submitted"),
        lt(klingSceneJobsTable.updatedAt, submittedCutoff),
      ),
    );

  // Find scenes stuck in "processing" (submitted to Kling but never completed)
  const stuckProcessing = await db
    .select({ id: klingSceneJobsTable.id, videoId: klingSceneJobsTable.videoId, retryCount: klingSceneJobsTable.retryCount })
    .from(klingSceneJobsTable)
    .where(
      and(
        eq(klingSceneJobsTable.status, "processing"),
        lt(klingSceneJobsTable.updatedAt, processingCutoff),
      ),
    );

  const allStuck = [...stuckSubmitted, ...stuckProcessing];

  if (allStuck.length === 0) {
    logger.info("[RenderMonitor] No stuck scenes found");
    return { stuckSubmitted: 0, stuckProcessing: 0, totalReset: 0, timestamp: now.toISOString() };
  }

  logger.warn(
    {
      stuckSubmitted: stuckSubmitted.length,
      stuckProcessing: stuckProcessing.length,
      sceneIds: allStuck.map(s => s.id),
    },
    "[RenderMonitor] Stuck scenes detected",
  );

  // Filter out scenes that have exceeded the auto-recovery retry cap
  const recoverable = allStuck.filter(s => s.retryCount < MAX_AUTO_RECOVERY_RETRIES);
  const beyondRetry = allStuck.filter(s => s.retryCount >= MAX_AUTO_RECOVERY_RETRIES);

  if (beyondRetry.length > 0) {
    // Mark permanently failed — these have been retried too many times automatically
    await db
      .update(klingSceneJobsTable)
      .set({
        status: "failed",
        errorMessage: "Timed out after maximum automatic recovery attempts",
        updatedAt: now,
      })
      .where(inArray(klingSceneJobsTable.id, beyondRetry.map(s => s.id)));

    logger.warn(
      { count: beyondRetry.length, ids: beyondRetry.map(s => s.id) },
      "[RenderMonitor] Scenes beyond retry cap — marking failed",
    );
  }

  if (recoverable.length === 0) {
    return {
      stuckSubmitted: stuckSubmitted.length,
      stuckProcessing: stuckProcessing.length,
      totalReset: 0,
      timestamp: now.toISOString(),
    };
  }

  // Reset recoverable scenes to "pending" — SceneManager will re-process them
  await db
    .update(klingSceneJobsTable)
    .set({
      status: "pending",
      klingTaskId: null,
      externalTaskId: null,
      errorMessage: null,
      retryCount: sql`${klingSceneJobsTable.retryCount} + 1`,
      lastRetryAt: now,
      updatedAt: now,
    })
    .where(inArray(klingSceneJobsTable.id, recoverable.map(s => s.id)));

  logger.info(
    { count: recoverable.length, ids: recoverable.map(s => s.id) },
    "[RenderMonitor] Scenes reset to pending for re-processing",
  );

  // Re-queue each unique video's pending scenes through SceneManager
  const uniqueVideoIds = [...new Set(recoverable.map(s => s.videoId))];
  const { getSceneManager } = await import("./sceneManager.js");
  const manager = getSceneManager();

  for (const videoId of uniqueVideoIds) {
    logger.info({ videoId }, "[RenderMonitor] Re-starting scene rendering for recovered video");
    manager.startSceneRendering(videoId);
  }

  return {
    stuckSubmitted: stuckSubmitted.length,
    stuckProcessing: stuckProcessing.length,
    totalReset: recoverable.length,
    timestamp: now.toISOString(),
  };
}

// ── Metrics snapshot ──────────────────────────────────────────────────────────

export interface RenderMetrics {
  queue: ReturnType<ReturnType<typeof getRenderQueue>["getMetrics"]>;
  activeScenes: { pending: number; submitted: number; processing: number; succeed: number; failed: number };
  timestamp: string;
}

export async function getRenderMetrics(): Promise<RenderMetrics> {
  const counts = await db
    .select({
      status: klingSceneJobsTable.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(klingSceneJobsTable)
    .groupBy(klingSceneJobsTable.status);

  const statusMap: Record<string, number> = {};
  for (const row of counts) statusMap[row.status] = row.count;

  return {
    queue: getRenderQueue().getMetrics(),
    activeScenes: {
      pending:    statusMap["pending"]    ?? 0,
      submitted:  statusMap["submitted"]  ?? 0,
      processing: statusMap["processing"] ?? 0,
      succeed:    statusMap["succeed"]    ?? 0,
      failed:     statusMap["failed"]     ?? 0,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Background job ────────────────────────────────────────────────────────────

export function startRenderMonitor(): NodeJS.Timeout {
  logger.info(
    { intervalMs: MONITOR_INTERVAL_MS },
    "[RenderMonitor] Starting background monitor",
  );

  // Run once immediately at startup to recover any orphaned jobs from
  // the previous server instance.
  void recoverStuckScenes().catch(err => {
    logger.error({ err }, "[RenderMonitor] Startup recovery failed");
  });

  const interval = setInterval(() => {
    void recoverStuckScenes()
      .then(result => {
        if (result.totalReset > 0) {
          logger.warn(result, "[RenderMonitor] Recovery cycle complete");
        } else {
          logger.info(result, "[RenderMonitor] Routine check — no stuck scenes");
        }
      })
      .catch(err => {
        logger.error({ err }, "[RenderMonitor] Recovery cycle error");
      });
  }, MONITOR_INTERVAL_MS);

  // Don't block graceful shutdown
  interval.unref();

  return interval;
}
