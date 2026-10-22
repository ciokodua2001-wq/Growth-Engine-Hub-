# RDS t4g Cost Evaluation + Zero-Cost Validation Results

Baseline: commit 5834377. No infrastructure purchased. The c7g.xlarge FFmpeg node is DEFERRED (exceeds budget); do not provision it.

## Zero-cost validation (completed, this pass)

### 1. DB migration rehearsal - PASSED
- `pg_dump -Fc` both DBs, `pg_restore --no-owner` into scratch databases on the same host.
- Row counts matched source vs rehearsal: users 8, projects 13, session 10, commercial_assemblies 50, videos 20, kling_scene_jobs 42.
- Scratch DBs and dumps removed afterward.
- Finding: `growthforge_prod` is EMPTY (0 rows across all app tables) - its migration is schema-only, so a prod cutover is near-instant.

### 2. Clean benchmark (load generator at nice 19 to approximate off-host) - confirms no scaling
| Config | Throughput | p50 | p95 | p99 |
|---|---|---|---|---|
| 1 worker (direct) | 236 req/s | 793ms | 985ms | 1166ms |
| 2 workers (Caddy LB) | 241 req/s | 691ms | 2236ms | 3502ms |

**~0% throughput gain and 2.3x worse p95 for 2 workers**, even with the load-gen CPU artifact reduced. This independently confirms the cab62d5 conclusion: the ~240-270 req/s ceiling is the shared-host CPU/DB bottleneck, not worker count.

## RDS t4g cost evaluation (lowest-cost dedicated PostgreSQL)

On-demand, single-AZ, ca-central-1, ESTIMATES - confirm exact figures in the AWS console before purchase.

| Instance | vCPU/RAM | Baseline CPU | Instance ~/mo | +20GB storage | Total ~/mo | vs $20 cap |
|---|---|---|---|---|---|---|
| db.t4g.micro | 2 / 1GB | 10% (0.2 vCPU) | ~$12 | ~$2.3 | ~$14 | UNDER |
| db.t4g.small | 2 / 2GB | 20% (0.4 vCPU) | ~$23 | ~$2.3 | ~$25 | OVER |
| db.t4g.medium | 2 / 4GB | 40% (0.8 vCPU) | ~$47 | ~$2.3 | ~$49 | OVER |

Measured PostgreSQL CPU under 200-concurrent load: ~0.12-0.15 vCPU.

## Recommendation

- **db.t4g.micro (~$14/mo) is the only sub-$20 option** and is likely sufficient for current load (0.2 vCPU baseline vs ~0.15 vCPU measured, with burst credits for spikes). This is the lowest-cost first step.
- db.t4g.small (~$25/mo) and db.t4g.medium (~$49/mo) exceed the $20 cap and require a re-benchmark (REBENCHMARK_PLAN.md) before purchase.
- Sequence: migrate to t4g.micro (under cap) -> re-benchmark 1 vs 2 workers -> if the DB is CPU-starved, that re-benchmark justifies stepping to t4g.small.

## Gate (unchanged)

No throughput claim above ~240-270 req/s until the re-benchmark passes: 2 workers >= 1.6x at equal-or-lower p95, p95 < 800ms, 0 5xx / 0 neterr.
