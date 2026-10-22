# PostgreSQL Dedicated-CPU Strategy (ca-central-1)

Baseline: commit cab62d5. Plan only — no provisioning until authorized.

## Why this is the real scaling blocker (measured)
The concurrency benchmark showed the API throughput ceiling (~240-270 req/s) is NOT the API worker count (2 workers gave ~0% gain) and NOT the pool size (10/20/30 identical). CPU sampling showed the API worker at ~72% of one core with PostgreSQL ~15% on the SAME 2 vCPUs, plus the load generator stealing ~30-50%. Adding API workers on this host is counterproductive because everything shares 2 cores. PostgreSQL must move to dedicated CPU before a second API worker can ever be a net win.

## Current state (verified)
- PostgreSQL 16, loopback-only (`listen_addresses=localhost`, `pg_hba` 127.0.0.1/32 + ::1/128), `max_connections=100`.
- Two databases on the same instance: `growthforge_dev` (53 MB) and `growthforge_prod` (36 MB). ~90 MB total — migration is trivial.
- DEV and PROD API connect to `127.0.0.1:5432` with separate roles (`growthforge_app_dev`, `growthforge_prod`).

## Options (on-demand estimates — confirm in console)
| Option | Pros | Cons | ~$/mo |
|---|---|---|---|
| **RDS Postgres 16, db.t4g.small/medium** | Managed (backups, patching, optional HA), no OS admin | VPC/subnet + security-group setup; slightly higher cost at scale | ~$12-40 |
| **Dedicated EC2 + Postgres 16 (c7g.large)** | Full control, can also host the load generator | Self-managed backups/patching | ~$53 |
| Aurora Serverless v2 | Auto-scaling | Overkill for ~90 MB | not recommended |

Recommendation: **RDS db.t4g.small/medium** for managed ops, or **dedicated EC2 c7g.large** if you want to co-locate the off-host load generator for future benchmarks. Both live in the same `ca-central-1` VPC and expose a private IP.

## Migration steps (pg_dump/restore, ~minutes)
1. Provision the target (RDS instance or EC2), note the private endpoint/host + port.
2. Create roles + databases on the target (`growthforge_app_dev`, `growthforge_prod`, `growthforge_dev`, `growthforge_prod`).
3. `pg_dump -Fc` each source DB and `pg_restore` into the target (dev first, then prod).
4. Update `DATABASE_URL` in `/home/ubuntu/dev/app/.env` and `/home/ubuntu/prod/app/.env` to the new private host.
5. Restart `growthforge-dev-api` and `growthforge-prod-api`; verify `/api/healthz` and one authenticated request each.
6. Point the FFmpeg worker's `DATABASE_URL` at the new host too (see `FFMPEG_NODE_CUTOVER.md`).

## Cutover + rollback
- Cutover: switch `DATABASE_URL`, restart services. Both DBs are small, so downtime is seconds.
- Rollback: point `DATABASE_URL` back at `127.0.0.1:5432`, restart services. Keep the old Postgres running (read-only) until the new one is verified.

## Security
- Keep the new DB private (no public IP). Allow only the API host + FFmpeg node security groups.
- Reuse scram-sha-256 + the existing roles; add a `pg_hba`/RDS security-group rule for the FFmpeg node's private IP.

## Gate
After the move, run `REBENCHMARK_PLAN.md` before claiming any throughput above the measured 240-270 req/s ceiling.
