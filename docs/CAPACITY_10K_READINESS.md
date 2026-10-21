# GROWTHFORGE — VERIFIED CAPACITY & 10,000-SUBSCRIBER READINESS

Date: 2026-10-21. Environment: DEV only (no production changes). Optimizer in observe mode.
Evidence basis: measured load tests + FFmpeg benchmarks on the live DEV host.

## A. Current infrastructure
- AWS Lightsail (or equivalent): 2 vCPU Intel Xeon 8259CL @2.5GHz, 7.6 GiB RAM (6.2 available), 154 GB disk (7% used).
- Node v24.18.1, single-process Express API (`growthforge-dev-api`), V8 heap limit 2240 MB. RSS: ~460 MB at deploy, ~1400 MB peak under load, reclaimed after (no leak).
- PostgreSQL 16, `max_connections=100`, API `pg` pool default `max=10`.
- FFmpeg 6.1.1 (libx264, auto-threading uses both cores per job).
- Background jobs: in-process `node-cron` (autonomous optimizer, observe) + `renderMonitor` (setInterval). No external queue.
- Monitoring: pino logs (systemd journal), `renderMonitor`, `/api/healthz`. No external alerting or metrics.

## B. Methodology + workload
- Synthetic cohort: 600 users + projects + sessions, created with real Better Auth signed
  session cookies (real auth middleware validates them against the `session` table).
- Authenticated endpoint mix (weighted): auth/me 8, projects 4, project 8, dashboard 10,
  analysis 10, strategy 6, content 12, social-posts 6, campaigns 12, videos 10,
  competitors 5, usage 5, autonomous/decisions 4.
- Load generator runs on the SAME host as the API (Python threads + urllib), so measured
  throughput is conservative (client CPU competes with the server).
- Ramp: 10 → 25 → 50 → 100 → 200 → 300 → 500 concurrent, ~60 s per stage.

## C. Authenticated concurrency results
| Concurrent | Throughput | p50 | p95 | p99 | 401 | 403 | 429 | 5xx | net err |
|---|---|---|---|---|---|---|---|---|---|
| 10 | 214/s | 39 ms | 82 ms | 164 ms | 0 | 0 | 0 | 0 | 0 |
| 25 | 273/s | 87 ms | 122 ms | 136 ms | 0 | 0 | 0 | 0 | 0 |
| 50 | 274/s | 175 ms | 211 ms | 234 ms | 0 | 0 | 0 | 0 | 0 |
| 100 | 269/s | 356 ms | 413 ms | 461 ms | 0 | 0 | 0 | 0 | 0 |
| 200 | 270/s | 704 ms | 758 ms | 806 ms | 0 | 0 | 0 | 0 | 0 |
| 300 | 268/s | 1074 ms | 1159 ms | 1195 ms | 0 | 0 | 0 | 0 | 0 |
| 500 | 264/s | 1817 ms | 1896 ms | 1984 ms | 0 | 0 | 0 | 0 | 0 |

- **Hard throughput ceiling ≈ 270 authenticated req/s** (single Node process).
- **Zero errors at every level** (no auth failures, no cross-tenant, no 429/5xx).
- p95 < 1 s holds to ~200 concurrent; p99 < 3 s holds to 500 concurrent.
- Resources: DB connections stable ~16 (pool max 10 not the limiter), 0 slow queries (>500 ms), API RSS stable (no growth), load peak ~4.4 (2 cores).

## D. AI / video job capacity
FFmpeg 4-scene assembly (libx264, 40 s output):
| Concurrent jobs | Wall | Per-job | 
|---|---|---|
| 1 | 25.9 s | 25.9 s |
| 2 | 50.1 s | 50.1 s |
| 3 | 75.0 s | 74.8 s |
| 5 | 126.5 s | 126.5 s |

- Jobs **serialize** (libx264 auto-threading already uses both cores): N jobs = N × wall time.
  Throughput ≈ 138 assemblies/hour regardless of concurrency (CPU-bound).
- Load average hit 18 at 5 jobs (9× oversubscription). **Max safe simultaneous FFmpeg = 1**
  on the shared host; 2+ starve the interactive API.

## E. Mixed workload (1 assembly + 50 interactive users)
- Interactive p95 211 ms → 376 ms (+78%), throughput 274 → 197 req/s (−28%).
- The FFmpeg job slowed 26 s → 67 s (2.6×).
- Background FFmpeg directly competes with interactive capacity on the shared 2 CPUs.

## F. Measured bottlenecks + safety limits
1. **CPU** — single-process Node (event loop) + FFmpeg share 2 cores; first and dominant bottleneck.
2. **Throughput ceiling ~270 req/s** for authenticated requests.
3. **FFmpeg/API contention** — 1 background job costs ~28% of interactive throughput.
4. Not (at tested levels): DB pool (max 10), DB connections (peak 16), memory (peak 1.4 GB < 2.2 GB heap), slow queries (0).

## G. Subscriber capacity model
Assumptions (stated, not measured): average active user generates 0.10 req/s (10 s think time).
Safe interactive capacity = 270 × 0.70 (30% headroom) ≈ 190 req/s ≈ 1,900 concurrent active users.
Peak active users = subscribers × concurrent-active %.

| Subscribers | 1% active | 3% | 5% | 10% | req/s @10% (0.1 r/s) |
|---|---|---|---|---|---|
| 1,000 | 10 | 30 | 50 | 100 | 10 |
| 5,000 | 50 | 150 | 250 | 500 | 50 |
| 10,000 | 100 | 300 | 500 | 1,000 | 100 |
| 25,000 | 250 | 750 | 1,250 | 2,500 | 250 |

Video demand (assemblies/day): low 1/100 subs, medium 1/50, high 1/20.
| Subscribers | low | medium | high | high @hour (vs 138/hr capacity) |
|---|---|---|---|---|
| 1,000 | 10 | 20 | 50 | 2 |
| 5,000 | 50 | 100 | 250 | 10 |
| 10,000 | 100 | 200 | 500 | 21 |
| 25,000 | 250 | 500 | 1,250 | 52 |

## H. Verdicts
- **1,000 subscribers — SUPPORTED UNDER TESTED ASSUMPTIONS.**
- **5,000 subscribers — SUPPORTED UNDER TESTED ASSUMPTIONS** (all concurrency scenarios within measured limits).
- **10,000 subscribers — CONDITIONAL — REQUIRES SPECIFIED LIMITS** (supported at ≤10% concurrent at 0.1 req/s; p95 >1 s only during rare 500-simultaneous-request spikes; recommend a scaling trigger + alerting).
- **25,000 subscribers — REQUIRES INFRASTRUCTURE UPGRADE** (need ≥2 API workers + CPU; 250 req/s at 10% concurrent exceeds the single-process safe ceiling).
- Recommended initial beta subscriber limit: **10,000** (with p95 alerting), scale at ~70% of the 270 req/s ceiling (~190 req/s) or p95 > 800 ms sustained.

## I. Minimum changes for 10,000 subscribers
1. **Separate FFmpeg into a dedicated worker** (own process + CPU or a second small instance) — removes the 28% interactive penalty.
2. **Horizontal API scaling** (2 workers behind Caddy/LB) — raises the ceiling from 270 to ~540 req/s.
3. **Raise pg pool** `max` from 10 (or set `PGPOOL`/pool config) to ~20–30 to match 2+ workers.
4. **Add p95/error alerting** on `/api/healthz` + a load metric (optional, urgent for safety).
5. Durable queue for video jobs (optional; current in-process jobs recover via `stuckPublishRecovery`, but a queue gives fairness + survives restart).

## J. Confidence + untested assumptions + risks
- Confidence: **HIGH** for interactive API throughput/error behavior (measured); **MEDIUM** for subscriber math (request-rate assumption unvalidated against real telemetry); **LOW** for provider-side AI/Veo quota (not measured — external, no paid calls made).
- Untested: real browser think-time distribution; Stripe webhook/billing under load; Wasabi upload throughput; Gemini/Veo quota concurrency; cross-host (external) load generator.
- Risks: single-process API = single point of failure; FFmpeg+API contention; no auto-scaling; no alerting.

## K. Evidence / commits / tooling
- Tooling: `scripts/capacity/{cohort,authload,ffbench,one_level}.py` + README.
- Synthetic data: 600 users/projects/sessions (`is_test_account=true`, project ids 90001+), deletable.
- No production changes; optimizer remained observe; no paid AI/Veo calls; no Stripe charges.
