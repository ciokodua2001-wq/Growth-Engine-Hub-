# Concurrency Benchmark - 2 API Workers + PostgreSQL Pool Sizing

Commit lineage: follows 25801f2 (FFmpeg isolation). Host: AWS EC2 ca-central-1, 2 vCPU, 7.8GB RAM. PostgreSQL 16 local (max_connections=100). Caddy 2.11.4 already installed.

## Method

- **2-worker test**: a second dev API process on :4003 behind a standalone Caddy LB on :4004 (reverse_proxy 127.0.0.1:4001 127.0.0.1:4003). Load via scripts/capacity/authload.py (now honors API_BASE), 600 synthetic authenticated users, weighted endpoint mix, 60s runs.
- **Pool test**: single worker on :4001, DB_POOL_MAX set via systemd (10/20/30), 200 concurrent, 60s.
- **CPU split**: ps sampling during a 200-concurrent run.

## Results

### 2 API workers behind Caddy (vs single-worker baseline ~240-270 req/s)

| Concurrency | Throughput | p50 | p95 | p99 | 5xx | load peak |
|---|---|---|---|---|---|---|
| 100 | 227 req/s | 375ms | 1180ms | 1789ms | 0 | 6.5 |
| 200 | 248 req/s | 690ms | 1882ms | 3423ms | 0 | 6.5 |
| 400 | 253 req/s | 1304ms | 3307ms | 6114ms | 0 | 5.8 |
| 500 | 239 req/s | 1743ms | 4803ms | 9561ms | 0 | 7.1 |

**2 workers did not increase throughput and materially worsened latency** (single-worker @200 was p95 ~780-1200ms vs 2-worker p95 1882ms).

### PostgreSQL pool size (single worker, 200 concurrent)

| DB_POOL_MAX | Throughput | p50 | p95 | p99 | load peak |
|---|---|---|---|---|---|
| 10 | 239 req/s | 745ms | 1234ms | 1350ms | 4.2 |
| 20 | 238 req/s | 747ms | 1287ms | 1389ms | 4.9 |
| 30 | 238 req/s | 742ms | 1203ms | 1372ms | 7.6 |

**Pool size made no meaningful difference.**

### CPU split (200 concurrent, single worker)

- Node API worker: ~72-77% of one core
- PostgreSQL: ~15% aggregate
- Load generator (python, same host): ~30-50% of one core (measurement artifact - makes results conservative)

## Findings

1. The throughput ceiling (~240-270 req/s) is NOT the API worker CPU or the DB pool - it is CPU contention on a shared 2-vCPU host (API + PostgreSQL + FFmpeg worker all share the same 2 cores), plus the load generator stealing CPU during measurement.
2. Horizontal scaling ON THE SAME HOST yields ~0% throughput improvement and degrades p95. There is no measured basis to claim 1,500 req/s.
3. DB_POOL_MAX beyond 10 provides no benefit; keep the default 10.

## Recommended production configuration

- Keep 1 API worker on the current host (adding a 2nd on this host is counterproductive).
- Keep DB_POOL_MAX=10.
- To scale API throughput, the measured bottleneck must move first: separate PostgreSQL onto dedicated CPU (RDS/managed or a dedicated DB instance) and re-benchmark. Only then does a 2nd API worker become a net win.
- Move the FFmpeg worker to a dedicated node for assembly isolation/throughput (not API throughput).

## Costed plan - dedicated FFmpeg worker (AWS ca-central-1)

(On-demand estimates to be confirmed in the AWS console before spend.)

| Option | vCPU / RAM | ~/hr | ~/mo |
|---|---|---|---|
| c7g.xlarge (Graviton3) | 4 / 8GB | 0.145 | ~106 |
| c7g.2xlarge (Graviton3) | 8 / 16GB | 0.29 | ~212 |

Required to move the worker off-host:
1. Open PostgreSQL to the VPC (listen_addresses + pg_hba rule for the new node private IP) or switch to RDS.
2. Copy DATABASE_URL + the OBJECT_STORAGE_* Wasabi vars + DEFAULT_OBJECT_STORAGE_BUCKET_ID into the new node .env (FFmpeg worker does NOT need Google/Veo keys).
3. Install ffmpeg + copy the growthforge-ffmpeg-worker.service unit; set FFMPEG_WORKER_MAX_CONCURRENCY to 2-4 on the larger instance.
4. No new load balancer and no new database are required (the worker polls PostgreSQL directly).
