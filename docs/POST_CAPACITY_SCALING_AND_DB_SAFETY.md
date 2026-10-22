# GrowthForge — Post-Capacity Verification: Scaling & Database Safety

Date: 2026-10-22 (UTC) · DEV only · Follows commit `4fc4ebb` (2,000-user CONDITIONAL PASS)
Author: automated capacity + DB-safety review

---

## 1. Database backup / recovery verdict

**PARTIAL — prod is backed up; dev has a gap; restore is untested.**

| Item | Status |
|---|---|
| Automated snapshots | Lightsail managed DB takes daily automatic snapshots (standard feature). **Exact retention could not be read this turn** — the host CLI is `AccessDenied` (instance role `430300055564` vs console account `848554269944`); verify in the Lightsail console **Snapshots & restore** tab. |
| Point-in-time recovery | **Not supported** by Lightsail managed DB (RDS Aurora feature). Recovery is snapshot-level + `pg_dump` only. |
| DB size | `growthforge_dev` 29 MB, `growthforge_prod` 12 MB. |
| Encryption | At-rest AES-256 (default); in-transit SSL required (`sslmode=require`). |
| Access | Public mode **disabled** (private Lightsail VPC only). |
| `growthforge-backup.sh` (cron 3:00) | **STALE** — `sudo -u postgres pg_dump -d growthforge_dev` dumps **local** Postgres, not the managed DB. |
| `backup-to-wasabi.sh` (cron 3:30) | Generic "Supabase" script reused from another project — reads `DATABASE_URL`/`SUPABASE_DB_URL` from a `backup.env`; **not confirmed** to target the managed DB. |
| `backup-prod-db.sh` (cron 4:30) | **CORRECT** — `pg_dump "$DATABASE_URL"` from prod `.env` (managed `growthforge_prod`) → Wasabi, GPG-encrypted. |
| `scripts/backup-postgres.sh` | STALE (local Postgres). |

**Restore procedure (untested — no restore performed; nothing was deleted):**
1. Prod/managed: `pg_restore --no-owner --no-acl -h <endpoint> -U dbmasteruser -d growthforge_prod <dump>` (or restore a Lightsail snapshot from the console).
2. Encrypted dumps: `gpg --decrypt --passphrase <PASSPHRASE> <file>.gpg > <file>.dump`.

**Required fix:** repoint `growthforge-backup.sh` (and confirm `backup-to-wasabi.sh`) at the managed DB so **dev** is covered too. See §8.

---

## 2. Benchmark corrections (reconciliation of `4fc4ebb`)

1. **"182.6 req/s" for the moderate profile is the offered rate, not a server ceiling.** The open-loop Poisson scheduler under-offered ~8–9% (thread overhead + sharing the 2 vCPUs under test); steady-state offered was ~190 req/s. The server **completed 100% of offered traffic** (0 timeouts, p95 157 ms, load 2.5) and was not saturated — it sustains **≥200 req/s**.
2. **Heavy "348.8 completed req/s" includes timed-out requests.** 92,276 of 345,304 finished requests were 30 s timeouts (26.7%). **Actual successful throughput ≈ 255.6 req/s.**
3. **Burst 2× "359 completed req/s" includes 382 timeouts.** Actual successful ≈ 350 req/s, but at p95 13.3 s (heavily degraded). Burst 1.5× (274 req/s) had **0 timeouts** but p95 1213 ms (above the 1000 ms SLO).
4. **Load generator was ON-host** (`nice -n 19`), disclosed; during FFmpeg saturation it was starved to ~89 req/s. No off-host generator existed without provisioning.
5. **FFmpeg interference used 2 concurrent encodes (`ffbench.py N=2`), NOT the production worker concurrency (`MAX_CONCURRENCY=1`).** The interference result is therefore a worse case than production's single concurrent encode.
6. **CPU saturation was inferred from load-average (load1 ≥ 2.0 on 2 vCPU) + the throughput plateau, not from per-core CPU%/cgroup throttle telemetry** (no cgroup CPU quota is set). Treat the "CPU-bound" conclusion as strong evidence, not direct utilization proof.

Net effect: the CONDITIONAL PASS verdict is unchanged, but the **headroom is best stated as "~25–50%"** and the heavy/burst "completed" figures should be read as *offered* rates, with the successful-throughput figures above.

---

## 3. AWS vs Hetzner vs OVHcloud (approximate monthly USD)

Prices are **approximate list prices** (rounded USD at ~1 EUR = 1.10; verify before committing). "Est" = estimate; others are published-ish list prices.

| Component | AWS (Lightsail/EC2) | Hetzner Cloud | OVHcloud |
|---|---|---|---|
| 2 vCPU / 4–8 GB API | $20–40 | CX22/CX32: $4–8 | $10–20 |
| 4 vCPU / 8–16 GB API | $40–80 (EC2 c6i.xlarge ~$124) | CX42/CPX31: $9–15 | $20–35 |
| 8 vCPU / 16–32 GB API | $160–190 (c6i.2xlarge) | CPX41: ~$31 | $40–60 |
| Managed PostgreSQL 1 GB | $15 (verified) | ~$9 (est) | ~$15 (est) |
| Managed PostgreSQL 2–4 GB | $30–60 | ~$20–40 (est) | ~$25–60 (est) |
| Dedicated FFmpeg 2–4 vCPU | $20–40 | $4–15 | $10–20 |
| Load balancer | ALB ~$22 | Caddy self-host (free) | Caddy self-host (free) |
| CDN | CloudFront ~$0.085/GB | — (use Cloudflare free/Pro) | — (use Cloudflare free/Pro) |
| Backups (offsite) | S3/Wasabi ~$6/TB | — | — |
| Monitoring | self-host (free) | self-host (free) | self-host (free) |

**Regions / latency for Canada, US, Europe, Africa:**
- **Canada:** AWS `ca-central-1` (Montreal) and OVH Beauharnois (QC) are in-region; Hetzner has no Canadian region (nearest US-East/Europe).
- **US:** all three (AWS `us-east-1`, Hetzner Ashburn VA, OVH US).
- **Europe:** all three (AWS `eu-*`, Hetzner Falkenstein/Nuremberg, OVH FR/DE/UK).
- **Nigeria, Ghana, South Africa, Kenya:** none of the three has in-region compute; AWS has Cape Town (`af-south-1`) for South Africa only. Expect ~150–250 ms from US-East/Europe to West/East Africa. **Mitigate with a CDN (Cloudflare free/Pro) for static assets + edge caching**; keep the API in US-East/Europe unless African volume justifies AWS Cape Town.

---

## 4. Recommended launch architecture

- **Current / 2,000 moderate (verified):** 2 vCPU API + managed DB 1 GB + FFmpeg on-host (accept CPU-contention risk). No change required to launch moderate traffic.
- **2,000 with burst tolerance:** 4 vCPU API (or move FFmpeg to a dedicated 2 vCPU box) — removes the measured CPU ceiling and FFmpeg contention.
- **5,000 (≈500 req/s):** 4 vCPU API + dedicated 2 vCPU FFmpeg + managed DB 1–2 GB + Caddy LB (if >1 API node).
- **10,000 (≈1,000 req/s):** 8 vCPU API (or 2× 4 vCPU behind Caddy) + dedicated 4 vCPU FFmpeg + managed DB 2–4 GB + CDN.

**Certification tests required before claiming each target (no assumption that vCPUs map linearly to users):**
- 5,000: open-loop 500 req/s with ≥5,000 distinct users, 15 min, p95 < 800 ms, 0 timeouts, 0 5xx, plus a 1.5× burst.
- 10,000: open-loop 1,000 req/s, 15 min, same criteria, plus 2× burst + FFmpeg-interference run.

---

## 5. Estimated infrastructure budget (monthly USD)

| Target | AWS | Hetzner | OVH |
|---|---|---|---|
| 2,000 moderate (current) | ~$35–55 | ~$15–25 | ~$20–30 |
| 2,000 + burst | ~$60–95 | ~$20–35 | ~$30–45 |
| 5,000 | ~$90–140 | ~$30–50 | ~$45–70 |
| 10,000 | ~$200–300 | ~$60–100 | ~$90–140 |

Hetzner is ~3–6× cheaper than AWS for equivalent CPU; a migration is a separate decision and was **not** performed.

---

## 6. Least-privilege database role status

**Implemented and tested in DEV (reversible):**
- Created `growthforge_app_dev` (LOGIN, `rolcreatedb=f`, `rolcreaterole=f`) — grants: CONNECT on `growthforge_dev`, USAGE+CREATE on schemas `public`/`stripe`/`drizzle`, SELECT/INSERT/UPDATE/DELETE on all tables, USAGE/SELECT on sequences.
- Created `growthforge_migrator_dev` (LOGIN, no create-role/create-db) — grants: USAGE+CREATE on schemas, ALL on tables/sequences (DDL for `pnpm --filter db push`).
- **Tests:** app role `SELECT count(*) FROM users` = OK; app role `CREATE TABLE` = **denied**; migrator `CREATE TABLE` = OK.
- **DEV runtime switched** to `growthforge_app_dev` (`.env` `DATABASE_URL`; prod `.env` **unchanged** on `dbmasteruser`). healthz 200, no permission errors, services active.

**Key finding:** the app runs **idempotent DDL at startup** (`CREATE TABLE IF NOT EXISTS …` across `public`/`stripe`, plus the `drizzle` migration schema). Therefore a strict DML-only runtime role is **not achievable without a code refactor** (move auto-migration out of the runtime process into an explicit migrate step). The implemented role is the practical floor: **DML + schema-CREATE, but no createdb/createrole and no ownership** — a material reduction from `dbmasteruser`.

**Production recommendation (not applied):** mirror `growthforge_app_prod` / `growthforge_migrator_prod` after the refactor; keep `dbmasteruser` as the break-glass admin only.

---

## 7. Local PostgreSQL dependency findings

- Local `postgresql@16-main` is still **running** (~95 MB RSS, 6 procs) but has **0 application connections** (app uses the managed DB).
- Files still referencing local Postgres (all **stale**, pre-migration): `growthforge-backup.sh`, `scripts/backup-postgres.sh`, `deploy/assign-owner.sh`, `deploy/provision-prod-db.sh`, `deploy/restore-test-prod.sh`, `restore-test-prod.sh`.
- `backup-to-wasabi.sh` is a generic/Supabase script (verify it does not need local Postgres).

**Decommission procedure (not executed; data not touched):**
1. Repoint `growthforge-backup.sh` to the managed DB; retire/update the stale deploy scripts.
2. Confirm a managed-DB restore works end-to-end (dry-run `pg_restore --list`).
3. Keep local Postgres as rollback through a stability window, then `systemctl stop && disable postgresql@16-main`.
4. Archive (do not delete) the local data dir.

---

## 8. Exact actions requiring your approval

1. **Fix dev backup:** repoint `growthforge-backup.sh` (and verify `backup-to-wasabi.sh`) at the managed `growthforge_dev`.
2. **Confirm Lightsail DB snapshot retention** in the console (read-only).
3. **Switch prod** `DATABASE_URL` to a least-privilege `growthforge_app_prod` role (after the §6 refactor).
4. **Stop/disable local `postgresql@16-main`** (after backup repoint + restore dry-run + stability window).
5. **Any infra purchase/migration** (Hetzner/OVH/AWS resize, dedicated FFmpeg node, CDN, larger managed DB).
6. **Deletion of the local Postgres data directory** (explicitly requires separate approval).

---

## 9. Commit hash and remaining risks

- **This report + role setup** committed in the follow-up commit (see final message).
- **Remaining risks:** dev backup gap until §8.1; snapshot retention unverified; restore untested; app runtime/migration conflation limits true least-privilege; load-gen on-host makes throughput conservative; Africa latency unmitigated without a CDN.

*No production deployment, infrastructure purchase, paid AI call, destructive DB change, or DNS cutover was performed.*
