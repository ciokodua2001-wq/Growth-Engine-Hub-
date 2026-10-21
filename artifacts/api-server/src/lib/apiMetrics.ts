/**
 * Lightweight in-process API metrics (no external deps). Tracks request latency
 * percentiles, 5xx rate, and sustained throughput in a bounded ring buffer, and
 * exposes a snapshot for the owner-only /owner/metrics endpoint.
 */

const RING_SIZE = 10000;          // last N requests for percentile computation
const WINDOW_MS = 60_000;         // rolling window for throughput + 5xx rate

type Entry = { ts: number; ms: number; status: number };

const ring: Entry[] = [];
let total = 0;
let total5xx = 0;

export function recordRequest(ms: number, status: number): void {
  total++;
  if (status >= 500) total5xx++;
  const now = Date.now();
  ring.push({ ts: now, ms, status });
  if (ring.length > RING_SIZE) ring.shift();
}

function percentile(p: number): number {
  if (ring.length === 0) return 0;
  const durs = ring.map((e) => e.ms).sort((a, b) => a - b);
  const idx = Math.min(Math.floor((durs.length - 1) * p), durs.length - 1);
  return durs[idx];
}

export function getApiMetricsSnapshot(): {
  latency: { p50: number; p95: number; p99: number; max: number; samples: number };
  errors: { total5xx: number; totalRequests: number; recent5xxRate: number };
  throughput: { reqPerSec: number; windowMs: number };
} {
  const now = Date.now();
  const recent = ring.filter((e) => e.ts >= now - WINDOW_MS);
  const recent5xx = recent.filter((e) => e.status >= 500).length;
  return {
    latency: {
      p50: Math.round(percentile(0.5)),
      p95: Math.round(percentile(0.95)),
      p99: Math.round(percentile(0.99)),
      max: ring.length ? Math.round(Math.max(...ring.map((e) => e.ms))) : 0,
      samples: ring.length,
    },
    errors: {
      total5xx,
      totalRequests: total,
      recent5xxRate: recent.length ? recent5xx / recent.length : 0,
    },
    throughput: {
      reqPerSec: recent.length ? recent.length / (WINDOW_MS / 1000) : 0,
      windowMs: WINDOW_MS,
    },
  };
}
