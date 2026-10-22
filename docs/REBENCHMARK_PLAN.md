# Re-benchmark Plan (benchmark-driven scaling gate)

Baseline: commit cab62d5. No throughput claim above ~270 req/s until this passes.

## Fixes over the previous measurement
1. **Move the load generator off the API host.** It consumed ~30-50% of one core on the same 2-vCPU host, making throughput figures conservative. Run it from the dedicated FFmpeg node or a third host in the same VPC.
2. **Separate PostgreSQL first** (see `POSTGRES_DEDICATED_CPU.md`) so the DB is no longer competing for the API's CPU.
3. **Run 1-worker vs 2-worker back-to-back** on the same code, same DB, same load generator.

## Steps
1. Confirm PostgreSQL is on dedicated CPU and the API host runs only the API.
2. Recreate the benchmark harness: copy `scripts/capacity/*` + `/tmp/cohort.json` to the load-gen host (or regenerate the cohort with `cohort.py`).
3. Start 1 worker; run:
   - `API_BASE=http://<api-private-ip>:4001 python3 one_level.py 200 120`
   - then 300, 400.
4. Start the 2nd worker (`deploy/growthforge-dev-api-2.service` on port 4003) + the Caddy LB (`scripts/capacity/bench-Caddyfile`); rerun the same levels against the LB.
5. Record throughput, p50/p95/p99, 5xx, neterr, CPU (API vs DB via `ps`), and DB connections.

## Acceptance criteria (all required before ANY scaling claim)
- 2 workers deliver **>= 1.6x** the 1-worker throughput at equal or lower p95.
- p95 stays below a stated SLO (propose <800ms) at the claimed concurrency.
- 5xx = 0 and neterr = 0 across every run.
- The per-run CPU split shows the API workers (not the DB) as the ceiling at the pass point.

## Reporting
Every scaling recommendation must cite these numbers, the commit, and the load-gen placement. No extrapolation beyond the measured concurrency range. 1,500 req/s is not claimable unless a re-benchmark at or above that level passes the criteria above.
