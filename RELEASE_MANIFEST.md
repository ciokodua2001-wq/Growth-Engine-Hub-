# GrowthForge — Release Manifest (DOCUMENT ONLY)

> Generated 2026-10-21. Snapshot of what would ship at cutover. **Not executed.**

## Builds
- Backend: `artifacts/api-server` (drizzle + Express + Better Auth), systemd `growthforge-prod-api`.
- Frontend: `artifacts/growthforge` (Vite SPA) served by Caddy.
- Commits at acceptance: `d9036a2` (autonomous resume), `0db8a3a` (test-harness repair), `90bbe07` (acceptance report).

## State at acceptance
- Test suite: **292/292** (18 files).
- Autonomous optimizer: `AUTONOMOUS_OPTIMIZER_ENABLED=true`, `MODE=observe` (recommendations only; no ad mutations).
- Stripe: test-mode only; webhook secret empty (must be set).
- Ads: Google not connected; Meta read-only (observe).

## Services / data
- PostgreSQL 16 (`growthforge_dev`), 7 migration files.
- Wasabi media (`OBJECT_STORAGE_*`), separate `BACKUP_S3_*`/GPG for backups.
- No stuck background jobs at acceptance.

## Feature gates
- Commercial Studio: approved (Auto/Prompt/My Script, captions, 0.25s lead, exports).
- Autonomous campaigns: enablement path locked at `c7a452c`; observe-only live.
- Billing: code + test-mode wired; production config pending.

## External blockers (unchanged)
1. Google Ads live certification.
2. Meta Ads act-mode certification.
3. Production re-provision + secrets + Stripe live config.
