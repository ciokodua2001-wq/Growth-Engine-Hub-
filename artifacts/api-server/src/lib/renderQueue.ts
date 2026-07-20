/**
 * RenderQueue — global concurrency limiter for external render API calls.
 *
 * Two independent pools:
 *   - Kling pool:    max concurrent text-to-video API submissions
 *   - Assembly pool: max concurrent FFmpeg processes (CPU-heavy)
 *
 * Usage:
 *   const release = await renderQueue.acquireKling();
 *   try { await submitToKling(...); } finally { release(); }
 *
 * Both pools are configurable via environment variables so that a single
 * config change scales throughput without a code deploy:
 *   KLING_CONCURRENCY   (default: 12)
 *   ASSEMBLY_CONCURRENCY (default: 3)
 *
 * Per-video decomposition locks prevent a race where two simultaneous
 * requests for the same video both call Claude and overwrite each other's
 * DB records. The lock is stored in-process (Map) since we are single-server.
 */

import pino from "pino";

const logger = pino({ name: "renderQueue" });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueueMetrics {
  kling: {
    maxConcurrent: number;
    active: number;
    queued: number;
    totalStarted: number;
    totalCompleted: number;
    totalFailed: number;
  };
  assembly: {
    maxConcurrent: number;
    active: number;
    queued: number;
    totalStarted: number;
    totalCompleted: number;
    totalFailed: number;
  };
  decompositionLocks: string[]; // videoIds currently locked for decomposition
  startedAt: string;
}

// ── Semaphore ─────────────────────────────────────────────────────────────────

interface PoolStats {
  maxConcurrent: number;
  active: number;
  totalStarted: number;
  totalCompleted: number;
  totalFailed: number;
  queue: Array<() => void>;
}

function createPool(maxConcurrent: number): PoolStats {
  return {
    maxConcurrent,
    active: 0,
    totalStarted: 0,
    totalCompleted: 0,
    totalFailed: 0,
    queue: [],
  };
}

function acquireSlot(pool: PoolStats, label: string): Promise<(success?: boolean) => void> {
  return new Promise(resolve => {
    const proceed = () => {
      pool.active++;
      pool.totalStarted++;
      logger.debug(
        { pool: label, active: pool.active, queued: pool.queue.length },
        "[RenderQueue] Slot acquired",
      );
      const release = (success = true) => {
        pool.active = Math.max(0, pool.active - 1);
        if (success) pool.totalCompleted++;
        else pool.totalFailed++;
        logger.debug(
          { pool: label, active: pool.active, queued: pool.queue.length, success },
          "[RenderQueue] Slot released",
        );
        // Wake next waiter
        const next = pool.queue.shift();
        if (next) next();
      };
      resolve(release);
    };

    if (pool.active < pool.maxConcurrent) {
      proceed();
    } else {
      pool.queue.push(proceed);
      logger.debug(
        { pool: label, active: pool.active, queued: pool.queue.length },
        "[RenderQueue] Slot queued — pool full",
      );
    }
  });
}

// ── RenderQueue class ─────────────────────────────────────────────────────────

class RenderQueue {
  private readonly klingPool: PoolStats;
  private readonly assemblyPool: PoolStats;
  private readonly decompositionLocks = new Map<number, Promise<void>>();
  private readonly startedAt = new Date().toISOString();

  constructor() {
    const klingMax = parseInt(process.env.KLING_CONCURRENCY ?? "12", 10);
    const assemblyMax = parseInt(process.env.ASSEMBLY_CONCURRENCY ?? "3", 10);

    this.klingPool = createPool(Math.max(1, klingMax));
    this.assemblyPool = createPool(Math.max(1, assemblyMax));

    logger.info(
      { klingMax: this.klingPool.maxConcurrent, assemblyMax: this.assemblyPool.maxConcurrent },
      "[RenderQueue] Initialized",
    );
  }

  /**
   * Acquires a slot in the Kling API concurrency pool.
   * Returns a release function — MUST be called in finally{}.
   * Pass false to release(false) if the job failed.
   */
  acquireKling(): Promise<(success?: boolean) => void> {
    return acquireSlot(this.klingPool, "kling");
  }

  /**
   * Acquires a slot in the FFmpeg assembly pool.
   * Returns a release function — MUST be called in finally{}.
   */
  acquireAssembly(): Promise<(success?: boolean) => void> {
    return acquireSlot(this.assemblyPool, "assembly");
  }

  /**
   * Acquires an exclusive per-video decomposition lock.
   *
   * If another caller is already decomposing the same videoId, this
   * awaits the existing lock (preventing duplicate Claude calls and DB writes).
   * Returns a release function — MUST be called in finally{}.
   */
  async acquireDecompositionLock(videoId: number): Promise<() => void> {
    // Wait for any existing lock on this video to clear
    const existing = this.decompositionLocks.get(videoId);
    if (existing) {
      logger.info({ videoId }, "[RenderQueue] Waiting for existing decomposition lock");
      await existing;
    }

    let releaseFn!: () => void;
    const lockPromise = new Promise<void>(resolve => { releaseFn = resolve; });
    this.decompositionLocks.set(videoId, lockPromise);

    logger.debug({ videoId }, "[RenderQueue] Decomposition lock acquired");

    return () => {
      this.decompositionLocks.delete(videoId);
      releaseFn();
      logger.debug({ videoId }, "[RenderQueue] Decomposition lock released");
    };
  }

  /**
   * Returns true if a decomposition is currently in flight for the given video.
   * Used to return early from the route handler with a 409.
   */
  isDecompositionInFlight(videoId: number): boolean {
    return this.decompositionLocks.has(videoId);
  }

  /** Returns a snapshot of current queue metrics for monitoring. */
  getMetrics(): QueueMetrics {
    return {
      kling: {
        maxConcurrent: this.klingPool.maxConcurrent,
        active: this.klingPool.active,
        queued: this.klingPool.queue.length,
        totalStarted: this.klingPool.totalStarted,
        totalCompleted: this.klingPool.totalCompleted,
        totalFailed: this.klingPool.totalFailed,
      },
      assembly: {
        maxConcurrent: this.assemblyPool.maxConcurrent,
        active: this.assemblyPool.active,
        queued: this.assemblyPool.queue.length,
        totalStarted: this.assemblyPool.totalStarted,
        totalCompleted: this.assemblyPool.totalCompleted,
        totalFailed: this.assemblyPool.totalFailed,
      },
      decompositionLocks: [...this.decompositionLocks.keys()].map(String),
      startedAt: this.startedAt,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: RenderQueue | null = null;
export function getRenderQueue(): RenderQueue {
  if (!_instance) _instance = new RenderQueue();
  return _instance;
}
