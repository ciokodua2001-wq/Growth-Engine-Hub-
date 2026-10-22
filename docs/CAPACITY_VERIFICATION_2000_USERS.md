# GrowthForge — 2,000 Concurrent Active User Capacity Verification

Date: 2026-10-22 (UTC) · Environment: DEV (`dev.usegrowthforge.com` → API :4001)
Deployed commit at test time: `e3703f8` · Author: automated capacity verification

---

## A. Executive verdict

**CONDITIONAL PASS — 2,000 active users handled under the light and moderate profiles, with material limitations.**

- **Light (0.05 req/s/user ≈ 100 req/s): PASS** — p95 21.6 ms, 0 errors.
- **Moderate (0.10 req/s/user ≈ 200 req/s): PASS** — p95 157.5 ms, 0 errors, 0 slow DB queries.
- **Heavy (0.20 req/s/user ≈ 400 req/s): FAIL** — 26.7% of requests timed out (p95 9.7 s).

The moderate profile is the launch-relevant target and it passes cleanly, but **headroom is limited to ~25–50%** (sustainable ceiling ≈ 250–300 req/s vs the 300+ req/s implied by closed-loop baselines). FFmpeg runs on the **same 2 vCPUs** as the API and measurably degrades it. See §D and §F.

---

## B. Measured results

### Phase 2 — Baseline reproduced (closed-loop, same weighted 13-endpoint authenticated mix)

| Test | Users | Offered RPS | Achieved RPS | p95 | p99 | 5xx % | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| 100 clients | — | — | 297.6 | 442.7 | 781.5 | 0 | (baseline) |
| 200 clients | — | — | 320.1 | 675.1 | 1098.7 | 0 | (baseline) |
| 400 clients | — | — | 295.0 | 1825.8 | 2331.6 | 0 | (baseline) |
| 500 clients | — | — | 307.8 | 1862.8 | 2587.4 | 0 | (baseline) |

### Phase 3 — 2,000 distinct users, open-loop arrival-rate controlled (Poisson), 15 min steady state

| Test | Users | Offered RPS | Achieved RPS | p50 | p95 | p99 | 5xx % | timeout % | load peak | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Light (0.05 rps/user) | 2000 | 93.4 | 93.4 | 7.5 | 21.6 | 115.5 | 0 | 0 | 1.50 | PASS |
| Moderate (0.10 rps/user) | 2000 | 182.6 | 182.6 | 11.8 | 157.5 | 256.2 | 0 | 0 | 2.50 | PASS |
| Heavy (0.20 rps/user) | 2000 | 348.8 | 348.8 | 1925.5 | 9698.2 | 30126.3 | 0 | 26.7 | 3.41 | FAIL |

### Phase 4 — Burst / viral spike (from ~200 req/s baseline)

| Test | Offered RPS | Achieved RPS | p50 | p95 | p99 | timeouts | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| baseline 200 | 189.6 | 189.6 | 11 | 113 | 248 | 0 | OK |
| burst 1.5× (300) | 274.0 | 274.0 | 538 | 1213 | 1852 | 0 | OK (degraded p95) |
| recover | 191.7 | 191.7 | 11 | 106 | 219 | 0 | recovered |
| burst 2× (400) | 359.0 | 359.0 | 5931 | 13273 | 33175 | 382 | degraded |
| recover | 191.4 | 191.4 | 17 | 5317 | 10706 | 6 | recovered (tail drain) |

### Phase 5 — Video (FFmpeg) interference under moderate load

| Test | p95 (ms) | load peak | offered rps | 5xx | timeouts | Verdict |
|---|---:|---:|---:|---:|---:|---|
| Moderate, no FFmpeg | 157.5 | 2.50 | 182.6 | 0 | 0 | baseline |
| Moderate + 2 concurrent FFmpeg encodes | 184.5 | 11.40 | ~89 (load-gen starved) | 0 | 0 | degraded |

FFmpeg encode cost (libx264 medium, 40 s 720p output): **64.7 s and 72.2 s** wall per job (2 concurrent).
Job-status polling (`GET /api/projects/{pid}/videos/{vid}/assemblies`) returned **200** with `overallStatus:"idle"`, empty `assemblies[]`.

### Database (managed PostgreSQL 18.6)

- Persistent `SELECT 1` round-trip: **0.802 ms avg, 12,461 TPS** (10 clients, pgbench).
- **0 slow queries (>500 ms) in every test**, peak DB connections **12**, `max_connections=81`.

---

## C. Evidence

**Test scripts (committed under `scripts/capacity/`):**
- `openload.py TARGET_RPS DUR PROFILE` — open-loop Poisson arrival generator (warmup 60 s ramp 20→100%, steady DUR, cooldown 30 s ramp 100→0), 2,000 distinct users, 30 s timeout, reports offered vs completed RPS, p50/p95/p99, status histogram, and system samples (load1, MemAvailable, API RSS, DB connections, slow queries).
- `burst.py` — 5-segment burst schedule (baseline 200 → 300 → recover → 400 → recover).
- `cohort.py N` (existing) — N synthetic users/projects/sessions with real signed Better Auth cookies (`is_test_account=true`, emails `cap-%`, project ids `90001..`). Patched to strip the node-only `uselibpqcompat` URL param for `psql`.
- `ffbench.py` (existing) — representative 4-scene concat encode using free `testsrc` media (no paid AI).

**Load generator placement:** ON the API host (no separate node available without spend). Disclosed limitation: the generator runs at `nice -n 19`; under FFmpeg CPU saturation it could not sustain the 200 req/s offer rate (measured ~89 req/s), confirming it is the lowest-priority process. Baseline/moderate numbers are therefore **conservative** (the generator shares the 2 vCPUs).

**Raw log locations (host):** `/tmp/phase3.log` (Phase 3), `/tmp/ffbench.log` (Phase 5), `/tmp/cohort.json`/`cohort.sql` (synthetic users), `/tmp/openload.py`, `/tmp/burst.py`.

**Environment (Phase 1):**
- API host: EC2-equivalent **2 vCPU** (Intel Xeon Platinum 8259CL @ 2.50 GHz), **7.8 GB RAM** (6.1 GB avail), no cgroup CPU cap; Node v24.18.1.
- DB: AWS Lightsail managed PostgreSQL **18.6**, 1 GB/2 vCPU/40 GB, Montreal `ca-central-1a`, SSL required, `dbmasteruser`, `max_connections=81`, `DB_POOL_MAX=10`.
- FFmpeg worker: **same host**, separate systemd process (`growthforge-ffmpeg-worker`), `MAX_CONCURRENCY=1`, 5 s poll, 2 retries.
- Reverse proxy: Caddy `dev.usegrowthforge.com` → `/api/*` → `localhost:4001` (single backend, no API load balancing).
- Services: `growthforge-dev-api` (4001), `growthforge-prod-api` (4002), `growthforge-ffmpeg-worker`, `caddy`, `postgresql@16-main` (**local Postgres still running, ~95 MB RSS, unused by app**).
- Cron: 3 nightly backup jobs. Rate limiting present in the app bundle (`RateLimit`).

**Cleanup:** 2,000 synthetic users/projects/sessions removed after testing. DEV restored to 1 worker; counts back to users=8, projects=13, commercial_assemblies=50, videos=20.

---

## D. Real capacity

- **Verified stable RPS:** ~93 (light) and ~183 (moderate) sustained 15 min with 0 errors; ~274 (1.5× burst, 45 s) with 0 timeouts but p95 1213 ms.
- **Verified active users:** 2,000 distinct authenticated users at light and moderate profiles; 2,000 at heavy **fails** (26.7% timeouts).
- **Maximum observed request concurrency:** the closed-loop baseline peaked at ~500 in-flight clients (307.8 req/s). Open-loop 2,000-user tests produced only ~2–4 in-flight requests at any instant (Poisson arrivals × ~12 ms service time).
- **Sustainable throughput ceiling ≈ 250–300 req/s.** Below ~200 req/s is clean (p95 < 200 ms); ~274 req/s is handled but p95 > 1 s; ~350 req/s produces 26.7% timeouts. **Safe operating headroom from the 200 req/s moderate target is ~25–50%, not 30%+ with confidence.**
- **Actual limiting component: API host CPU (2 vCPUs).** The database is definitively not the bottleneck (0.8 ms queries, 12.4k TPS, 0 slow queries, ≤12/81 connections under all loads).
- **Launch verdict:** 2,000 active users at the moderate profile are supported **today**, but launch-day bursts beyond ~250–300 req/s, heavy usage (0.2 req/s/user), or concurrent video generation will degrade latency and can time out.

---

## E. Scaling plan (cost estimates — published vs estimate are labelled)

The single cheapest improvement is **more API CPU**, because CPU is the measured ceiling. FFmpeg should move to its own (cheap) instance at the same time.

| Target | API compute | PostgreSQL | FFmpeg worker | Approx. monthly infra |
|---|---|---|---|---|
| 2,000 (moderate) | 2 vCPU/8 GB (current) | managed 1 GB ($15, current) | same host (risk) | ~$31–40 (current) |
| 5,000 (≈500 req/s) | 4 vCPU/8 GB | managed 1–2 GB ($15–30) | dedicated 2 vCPU | ~$50–90 AWS / ~$25–40 Hetzner |
| 10,000 (≈1,000 req/s) | 8 vCPU (or 2×4 vCPU + Caddy LB) | managed 2–4 GB ($30–60) | dedicated 4 vCPU | ~$150–250 AWS / ~$50–90 Hetzner |

- **API compute (published):** AWS Lightsail 4 GB/2 vCPU $20/mo, 8 GB/2 vCPU $40/mo; EC2 c6i.xlarge (4 vCPU) ~$0.17/hr ≈ $124/mo. Hetzner CCX/CX 4 vCPU ~€7–13/mo; 8 vCPU ~€15–22/mo. OVH 4 vCPU VPS ~$15–25/mo. **Hetzner/OVH are ~4–6× cheaper than AWS for equivalent raw CPU** (published list prices; a migration is a separate decision, not performed here).
- **PostgreSQL (published/estimate):** managed 1 GB ≈ $15/mo (AWS Lightsail, verified current). Larger managed tiers are the main scaling cost; self-hosting on the API box is cheaper but adds operational risk.
- **FFmpeg (estimate):** a dedicated 2–4 vCPU box is the highest-leverage reliability change (removes CPU contention with the API); ~$7–40/mo.
- **Load balancing:** Caddy (free, self-hosted) is sufficient at these scales; managed LB (~$20–40/mo) only needed past 2 nodes.
- **Backups:** managed DB snapshots (included) + Wasabi ~$6/TB/mo.
- **Monitoring:** pino/log-based today (free); Prometheus+Grafana on the API host ~$0 marginal.

**Upgrade triggers (measured):** p95 sustained >800 ms, 5xx >0, timeouts >0, or load1 >1.8 on the API host during normal traffic → add vCPU / move FFmpeg before growing users.

---

## F. Risks and unresolved limitations

- **Load generator limitation:** ran on the API host (nice -n 19); absolute throughput is conservative and the generator was CPU-starved during FFmpeg runs. No off-host generator was available without provisioning (not authorized).
- **Synthetic vs real behavior:** the 13-endpoint read mix + think-time model approximates, but does not capture, real write patterns, uploads, or long-lived WebSocket/SSE sessions.
- **External AI quotas:** journeys calling Google Cloud TTS, Veo, or transcription were **not exercised** (paid); the music-only FFmpeg path and read endpoints were used instead.
- **FFmpeg contention:** 2 concurrent encodes saturate the shared 2 vCPUs (load 11.4) and degrade API latency; the worker is a separate process but **not dedicated compute**.
- **Database resilience:** `max_connections=81` is a hard limit; multi-worker API scaling must stay within it (≈8 workers × pool 10). Local Postgres is still running (rollback path) and should be decommissioned after a stability window.
- **Geographic latency:** single region (ca-central-1); no CDN/global distribution measured.
- **Burst handling:** 2× (400 req/s) bursts produce timeouts; recovery is automatic but p95 stays elevated for ~30–60 s while the backlog drains.

---

*Verdict: CONDITIONAL PASS. 2,000 active users at the moderate profile are verified today with limited (~25–50%) headroom; heavy usage and video-generation spikes require additional CPU before they are safe.*
