# Dedicated FFmpeg-Node Cutover Plan (ca-central-1)

Baseline: commit cab62d5. This is a plan only — no provisioning until authorized.

## Objective
Relocate the FFmpeg assembly worker (currently `growthforge-ffmpeg-worker.service` on the 2-vCPU API host, Nice=10) to a dedicated AWS EC2 instance in `ca-central-1`, giving it dedicated CPU and removing it from contention with the API + PostgreSQL.

## Current state (verified)
- Worker is stateless: durable job state lives in PostgreSQL (`commercial_assemblies`). It atomically claims `pending -> processing`, retries (max 2), recovers stale claims on boot, and shuts down gracefully. Nothing lives in process memory.
- It polls PostgreSQL (currently loopback `127.0.0.1:5432/growthforge_dev`).
- It downloads scenes from + uploads renders to Wasabi (`s3.ca-central-1.wasabisys.com`, region `ca-central-1`).
- Scratch is `/tmp` (`os.tmpdir()`, per-job mkdtemp).
- ffmpeg 6.1.1 with libx264/libx265/aac. Match the Node.js version on the API host (`node --version`).

## Target sizing (on-demand estimates — confirm in console)
| Instance | vCPU/RAM | ~$/mo |
|---|---|---|
| c7g.xlarge (Graviton3) | 4 / 8GB | ~$106 |
| c7g.2xlarge (Graviton3) | 8 / 16GB | ~$212 |

Recommend c7g.xlarge; raise `FFMPEG_WORKER_MAX_CONCURRENCY` to 2 (4 vCPU) or 4 (8 vCPU). A single 2-scene assembly measured ~15s idle / ~60s under 50-user load; dedicated CPU should return it to ~15-30s.

## Prerequisites (do these first)
1. **PostgreSQL networking** — see `POSTGRES_DEDICATED_CPU.md`. The worker needs `DATABASE_URL` over the private VPC. Either open the current Postgres (`listen_addresses` + `pg_hba` rule for the new node's private IP) or move to RDS/dedicated DB. This is the single blocking prerequisite.
2. **Wasabi credentials** — copy env vars (below), no special networking (public HTTPS).
3. **IAM/SSH** — same keypair/SSM access as the existing host.

## Minimal env the worker requires (verified from the bundle)
- `DATABASE_URL`
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `OBJECT_STORAGE_ENDPOINT` (https://s3.ca-central-1.wasabisys.com)
- `OBJECT_STORAGE_REGION` (ca-central-1)
- `OBJECT_STORAGE_FORCE_PATH_STYLE`
- `PRIVATE_OBJECT_DIR`
- `PUBLIC_OBJECT_SEARCH_PATHS`
- `FFMPEG_WORKER_ID` (e.g. `ffmpeg-node-1`)
- `FFMPEG_WORKER_MAX_CONCURRENCY` (2-4)
- `FFMPEG_WORKER_MAX_RETRIES` (2)
- `FFMPEG_WORKER_POLL_MS` (5000)
- `FFMPEG_WORKER_STALE_CLAIM_MS` (900000; shorter in dev for fast recovery)

The worker does NOT need `BETTER_AUTH_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, or Google/Veo keys (confirmed absent from the bundle).

## Cutover steps (zero-downtime, no data loss)
1. Provision `c7g.xlarge` in `ca-central-1`, same VPC/subnet, security group allowing the DB port to the DB private IP.
2. Install Node.js (match version) and ffmpeg 6.x (libx264/libx265/aac).
3. Deploy the worker: `git clone` the repo, `pnpm install --frozen-lockfile`, `cd artifacts/api-server && node build.mjs` (produces `dist/ffmpeg-worker.mjs`). Or copy `dist/ffmpeg-worker.mjs` directly.
4. Write `/home/ubuntu/ffmpeg/.env` with the minimal vars above (`DATABASE_URL` pointing at the DB private IP).
5. Install the systemd unit (copy `deploy/growthforge-ffmpeg-worker.service`; set `EnvironmentFile` to the new `.env`, `FFMPEG_WORKER_ID`, and remove `Nice=10` since the node is dedicated).
6. `sudo systemctl daemon-reload && sudo systemctl enable --now growthforge-ffmpeg-worker`.
7. **Flip over**: on the API host `sudo systemctl stop growthforge-ffmpeg-worker`. The new node's worker claims whatever is pending; no assembly is lost (all state is in Postgres).
8. Verify: new worker logs `[worker] Starting`, then run one end-to-end assembly and confirm it completes (claimed_by = the new `FFMPEG_WORKER_ID`, status `complete`, render uploaded to Wasabi).

## Rollback
`sudo systemctl stop` on the new node, `sudo systemctl start growthforge-ffmpeg-worker` on the API host. Pending/processing jobs are durable and will be reclaimed (the worker recovers its own prior claims on boot).

## Acceptance
- One real assembly completes end-to-end on the new node.
- API host CPU no longer includes FFmpeg (verify `/owner/metrics` or `ps`).
- Rollback exercised at least once.
