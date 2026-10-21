/**
 * FFmpeg assembly worker — isolates commercial video assembly (FFmpeg) from the
 * interactive API process so CPU-heavy encodes never compete with dashboard
 * traffic. Standalone process run via systemd (growthforge-ffmpeg-worker.service).
 *
 * Design:
 *   - Durable job state: the API route writes commercial_assemblies rows with
 *     status="pending"; this worker claims and processes them. State lives in
 *     PostgreSQL, not process memory.
 *   - Atomic claiming: pending -> processing is a conditional UPDATE keyed on
 *     status="pending", so at most one worker can claim a row.
 *   - Concurrency limit: MAX_CONCURRENCY (default 1) videos at a time; the
 *     assembler already runs output formats sequentially.
 *   - Idempotency / no double output: the route dedups by options fingerprint
 *     and the conditional claim prevents double processing.
 *   - Retries: failed assemblies are reset to pending up to MAX_RETRIES.
 *   - Restart recovery: on boot, stale "processing" rows (from a crash) are
 *     reset to pending; queued "pending" rows survive restarts untouched.
 *   - Graceful shutdown: SIGTERM/SIGINT finish the in-flight video, then exit.
 */

import pino from "pino";
import os from "node:os";
import { db, commercialAssembliesTable, videosTable } from "@workspace/db";
import { and, eq, asc, lt, or, sql } from "drizzle-orm";
import { getAssembler, type AssemblyOptions, type OutputFormat } from "./lib/ffmpegAssembler.js";

const logger = pino({ name: "ffmpeg-worker" });

const WORKER_ID = process.env.FFMPEG_WORKER_ID ?? `${os.hostname()}-${process.pid}`;
const POLL_MS = parseInt(process.env.FFMPEG_WORKER_POLL_MS ?? "5000", 10);
const MAX_CONCURRENCY = parseInt(process.env.FFMPEG_WORKER_MAX_CONCURRENCY ?? "1", 10);
const MAX_RETRIES = parseInt(process.env.FFMPEG_WORKER_MAX_RETRIES ?? "2", 10);
const STALE_CLAIM_MS = parseInt(process.env.FFMPEG_WORKER_STALE_CLAIM_MS ?? "900000", 10); // 15 min

type AssemblyRow = typeof commercialAssembliesTable.$inferSelect;

let shuttingDown = false;

process.on("SIGTERM", () => { logger.info("[worker] SIGTERM received - finishing current job then exiting"); shuttingDown = true; });
process.on("SIGINT", () => { logger.info("[worker] SIGINT received - finishing current job then exiting"); shuttingDown = true; });

/** Reset processing rows left behind by a previous (crashed) worker. */
async function recoverStaleClaims(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const stale = await db
    .update(commercialAssembliesTable)
    .set({
      status: "pending",
      claimedBy: null,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(or(
      and(eq(commercialAssembliesTable.status, "processing"), eq(commercialAssembliesTable.claimedBy, WORKER_ID)),
      and(eq(commercialAssembliesTable.status, "processing"), lt(commercialAssembliesTable.claimedAt, cutoff)),
    ))
    .returning({ id: commercialAssembliesTable.id });
  if (stale.length > 0) {
    logger.warn({ count: stale.length, ids: stale.map((r) => r.id) }, "[worker] Reset stale processing assemblies to pending");
  }
  return stale.length;
}

/** Claim the next pending video's assemblies (atomic conditional update). */
async function claimNext(): Promise<{ videoId: number; rows: AssemblyRow[] } | null> {
  const [candidate] = await db
    .select({ videoId: commercialAssembliesTable.videoId })
    .from(commercialAssembliesTable)
    .where(eq(commercialAssembliesTable.status, "pending"))
    .orderBy(asc(commercialAssembliesTable.videoId))
    .limit(1);
  if (!candidate) return null;

  const claimed = await db
    .update(commercialAssembliesTable)
    .set({
      status: "processing",
      claimedBy: WORKER_ID,
      claimedAt: new Date(),
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(commercialAssembliesTable.videoId, candidate.videoId),
      eq(commercialAssembliesTable.status, "pending"),
    ))
    .returning();
  if (claimed.length === 0) return null; // raced with another worker
  return { videoId: candidate.videoId, rows: claimed };
}

/** Reconstruct AssemblyOptions from the stored options JSON (drop the fingerprint). */
function optionsFromRow(row: AssemblyRow): AssemblyOptions {
  const stored = (row.options as Record<string, unknown> | null) ?? {};
  const { optionsFingerprint: _fingerprint, ...rest } = stored;
  return rest as unknown as AssemblyOptions;
}

/** After assemble() returns, retry failed rows (up to MAX_RETRIES). */
async function retryFailed(videoId: number): Promise<number> {
  const failed = await db
    .select()
    .from(commercialAssembliesTable)
    .where(and(
      eq(commercialAssembliesTable.videoId, videoId),
      eq(commercialAssembliesTable.status, "failed"),
      lt(commercialAssembliesTable.retryCount, MAX_RETRIES),
    ));
  let reset = 0;
  for (const row of failed) {
    await db
      .update(commercialAssembliesTable)
      .set({
        status: "pending",
        claimedBy: null,
        claimedAt: null,
        retryCount: sql`${commercialAssembliesTable.retryCount} + 1`,
        lastRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(commercialAssembliesTable.id, row.id));
    reset++;
  }
  if (reset > 0) {
    logger.warn({ videoId, reset }, "[worker] Reset failed assemblies for retry");
  }
  return reset;
}

/** If every claimed assembly failed, reflect that on the parent video. */
async function reflectVideoFailure(videoId: number, rows: AssemblyRow[]): Promise<void> {
  const ids = rows.map((r) => r.id);
  const stillFailed = await db
    .select({ id: commercialAssembliesTable.id })
    .from(commercialAssembliesTable)
    .where(and(
      eq(commercialAssembliesTable.videoId, videoId),
      eq(commercialAssembliesTable.status, "failed"),
    ));
  const anyComplete = await db
    .select({ id: commercialAssembliesTable.id })
    .from(commercialAssembliesTable)
    .where(and(
      eq(commercialAssembliesTable.videoId, videoId),
      eq(commercialAssembliesTable.status, "complete"),
    ))
    .limit(1);
  if (stillFailed.length > 0 && anyComplete.length === 0 && ids.length > 0) {
    await db
      .update(videosTable)
      .set({ renderStatus: "failed", renderError: "Assembly failed after retries" })
      .where(eq(videosTable.id, videoId));
    logger.warn({ videoId, failed: stillFailed.length }, "[worker] Video marked failed (all assemblies failed)");
  }
}

async function processOne(videoId: number, rows: AssemblyRow[]): Promise<void> {
  const formats = rows.map((r) => r.outputFormat as OutputFormat);
  const assemblyIds = rows.map((r) => r.id);
  const options = optionsFromRow(rows[0]);
  logger.info({ videoId, assemblyIds, formats }, "[worker] Claimed assemblies - starting FFmpeg pipeline");
  try {
    await getAssembler().assemble(videoId, assemblyIds, formats, options);
    await retryFailed(videoId);
    await reflectVideoFailure(videoId, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, videoId }, "[worker] Assembly pipeline threw");
    await db
      .update(commercialAssembliesTable)
      .set({ status: "failed", errorMessage: msg.slice(0, 1000), completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(commercialAssembliesTable.videoId, videoId), eq(commercialAssembliesTable.status, "processing")));
    await db
      .update(videosTable)
      .set({ renderStatus: "failed", renderError: msg.slice(0, 500) })
      .where(eq(videosTable.id, videoId));
  }
}

async function main(): Promise<void> {
  logger.info({ workerId: WORKER_ID, pollMs: POLL_MS, maxConcurrency: MAX_CONCURRENCY, maxRetries: MAX_RETRIES }, "[worker] Starting FFmpeg assembly worker");

  const recovered = await recoverStaleClaims();
  if (recovered > 0) logger.warn({ recovered }, "[worker] Startup recovery complete");

  while (!shuttingDown) {
    const claimed = await claimNext();
    if (!claimed) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    await processOne(claimed.videoId, claimed.rows);
  }

  logger.info("[worker] Shutdown complete");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "[worker] Fatal error");
  process.exit(1);
});
