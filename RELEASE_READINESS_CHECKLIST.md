# GrowthForge — Production Release-Readiness Checklist (DOCUMENT ONLY)

> Generated 2026-10-21. **Nothing here is executed.** Production cutover requires separate explicit authorization.

## 1. Secrets & configuration (blocking)
- [ ] Set `STRIPE_WEBHOOK_SECRET` (currently empty in DEV `.env`) — enables webhook signature verification.
- [ ] Set `STRIPE_PUBLISHABLE_KEY` (frontend checkout) and live product/price IDs (Starter/Get-Going/Growth/Agency).
- [ ] Provision a production Wasabi bucket + separate `OBJECT_STORAGE_*` credentials (never reuse dev bucket).
- [ ] Confirm backup GPG + `BACKUP_S3_*` credentials exist for prod (separate from `OBJECT_STORAGE_*`).
- [ ] Rotate/issue prod-only secrets; keep them out of the repo and logs.

## 2. Provider certification (external, blocking for autonomy)
- [ ] Google Ads: production developer-token approval + OAuth consent-screen + restricted `googleads` scope verification; connect a real account.
- [ ] Meta Ads: long-lived/system-user token + App Review (`ads_management`/`ads_read`) + Business Verification + Live mode.
- [ ] Keep the optimizer in `observe` until the above are certified and you explicitly authorize `act`.

## 3. Production code & data
- [ ] Re-provision `/home/ubuntu/prod/app` from the current codebase (it is still the Aug-4 branch: no `betterAuth`, old `objectStorage`).
- [ ] Reconcile the prod DB migration track with `lib/db/migrations/` (0000–0005 + `meta/`); dev `__drizzle_migrations` is empty (push-based) — verify prod schema matches.
- [ ] Confirm `betterAuth` email flows + forgot-password work in the prod environment.

## 4. Cutover (requires your explicit authorization)
- [ ] Switch Caddy prod site from Coming Soon → SPA (do **not** do this without approval).
- [ ] Swap Stripe from test → live keys + register the live webhook endpoint.
- [ ] Set the prod DNS/TLS and remove the Coming Soon page only after smoke tests pass.

## 5. Verification before cutover
- [ ] Run the 292-test suite against prod config; require 292/292.
- [ ] Re-run cross-tenant security checks (20 ownership/authz tests) on prod data.
- [ ] Smoke-test: signup → email verify → project → content → Commercial Studio export (existing assets) → billing (test mode) → autonomous observe.
- [ ] Confirm capacity plan: single Node process / 2 vCPU ≈ 50 sustainable concurrent (measured DEV). Add workers/cores if >50 concurrent is a launch requirement.

## 6. Runbooks
- [ ] Backup/restore drill using `deploy/restore-test-prod.sh` on a throwaway DB.
- [ ] Rollback plan + `ROLLBACK.txt` updated.
- [ ] Monitoring/alerts on `/api/healthz`, render monitor, error rate, and webhook failures.
