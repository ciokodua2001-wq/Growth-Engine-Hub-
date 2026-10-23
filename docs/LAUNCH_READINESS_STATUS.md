# GrowthForge - Launch Readiness Status (Code Freeze)

Date: 2026-10-22 (UTC) · Read-only checks · Release candidate `d924839` · docs `0ffb76c`

## Readiness checks

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Production `OBJECT_STORAGE_*` config | **BLOCKED** | Prod has `DEFAULT_OBJECT_STORAGE_BUCKET_ID=growthforge` (wrong) and is missing `OBJECT_STORAGE_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY`. Plan requires a NEW `growthforge-prod-media` bucket + least-privilege sub-user (owner approval). |
| 2 | Stripe live billing | **LIVE key PROVIDED - NOT yet authorized** | Owner supplied a `rk_live_` restricted key (in project toolbox, root `.env`). Prod `.env` still `stub-not-configured`. Prod config PENDING VERIFICATION; live billing activation NOT YET AUTHORIZED. |
| 3 | E2E inline FFmpeg assembly | **PENDING** | Inline path is code-identical to the working worker path (`getAssembler().assemble()`); 41 historical inline + 4 recent worker completions prove it. Fresh isolated E2E not run (needs temp API+DB on the 512MB host). |
| 4 | Two-column migration | **PASS** | `deploy/reconcile-prod-schema.sql` = 2 nullable `ADD COLUMN` (`competitors.superseded_at`, `personas.superseded_at`). Additive; release candidate code depends on them (`isNull(supersededAt)` + `set supersededAt`). |
| 5 | Final verification steps | **PASS** | Runbook finalized (`docs/PRODUCTION_RELEASE_RUNBOOK.md`): build → migrate → inject env → restart → verify → cutover; rollback defined. |
| 6 | Deployment status table | **PASS** | See below. |

## Deployment status

| Layer | Status |
|---|---|
| GitHub `main` | `0ffb76c` |
| DEV running commit | `d924839` (via `/api/version`) |
| Production running commit | old build ≈ `db2516b` (no `/api/version`; `healthz` ok) |
| Public domain | `usegrowthforge.com` → **Coming Soon** |

## Authorization required before launch

1. Create Wasabi bucket `growthforge-prod-media` + least-privilege sub-user; supply `OBJECT_STORAGE_*` creds.
2. Verify + inject Stripe **LIVE** key (`rk_live_`, in toolbox) into prod `.env`; configure live webhook + products/prices.
3. Inject prod `.env` (`FFMPEG_WORKER_MODE=false`, `OBJECT_STORAGE_*`, Stripe live, toolbox Meta/Google, new `BETTER_AUTH_SECRET`).
4. Approve running `docs/PRODUCTION_RELEASE_RUNBOOK.md` (migration + build + restart + Caddy cutover).

*No deployment, schema change, restart, or routing change performed. Read-only verification only.*
