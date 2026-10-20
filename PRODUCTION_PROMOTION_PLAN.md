# GrowthForge - Production Promotion Plan (controlled beta)

> Status: DRAFT for owner review. **Nothing here is executed without explicit approval.**
> Authored: after Phase 1 (restore drill) and Phase 2 (Stripe lifecycle) acceptance.

## 0. Goal

Promote the current, verified dev application to the `usegrowthforge.com`
production host while keeping the public "Coming Soon" page untouched until
launch approval. Retire the stale Supabase-era production application.

Constraints (non-negotiable):
- Better Auth + Lightsail PostgreSQL + Wasabi + Google Veo. **No Supabase reactivation.**
- Do not touch prod DB / prod app / DNS / Caddy / live Stripe / Coming Soon without approval.
- Forward-only migrations; least-privilege Wasabi credentials; separate prod DB + bucket.

---

## 1. Current authoritative Git commit

- `main` @ `7265b8e` (and subsequent commits up to approval) - the fully
  browser/API-verified dev build. `git log --oneline -5` to confirm at execution time.
- The prod app dir `/home/ubuntu/prod/app` is a **non-git, Aug-4 codebase**
  (no `betterAuth.ts`, old `objectStorage.ts`) and is the thing being replaced.

## 2. Backup & rollback points (create BEFORE any change)

1. `sudo -u postgres pg_dump -Fc -d growthforge_prod > /var/backups/growthforge/growthforge_prod-predeploy-$(date +%Y%m%d-%H%M%S).dump`
   (or run the existing encrypted `deploy/backup-prod-db.sh`; both - one plaintext local, one encrypted Wasabi).
2. Snapshot prod env: `cp -a /home/ubuntu/prod/app /home/ubuntu/prod/app.bak-$(date +%Y%m%d-%H%M%S)` and
   `cp /home/ubuntu/prod/app/.env /home/ubuntu/prod/app/.env.bak-<ts>`.
3. Record `git rev-parse HEAD` + the old prod dist hash into a new `ROLLBACK.txt`.
4. Rollback = restore the DB dump into a throwaway to confirm, then (if needed) re-point
   `growthforge-prod-api.service` WorkingDirectory back to the `.bak` dir + `systemctl restart`.

## 3. Replace the stale Supabase-era prod application

1. `git clone` (or `git fetch --all && git checkout <sha>`) the current repo into a clean
   `/home/ubuntu/prod/app-new` (do NOT reuse the old dir in place).
2. `pnpm install --frozen-lockfile`; build API (`artifacts/api-server`) and frontend
   (`artifacts/growthforge`, `BASE_PATH=/`), exactly as dev is built.
3. Confirm the new dir has `lib/betterAuth.ts` + the Wasabi-aware `objectStorage.ts`.

## 4. Better Auth production configuration

- `BETTER_AUTH_SECRET`: generate a NEW prod-only value (`openssl rand -base64 32`), never reuse dev.
- `BETTER_AUTH_URL=https://usegrowthforge.com`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: OAuth app must have the authorized redirect URI
  `https://usegrowthforge.com/api/auth/callback/google` (and keep the dev URI for dev).
- Keep the `user`/`session`/`account`/`verification` tables in the prod DB (already present).

## 5. Separate production PostgreSQL database

- Already isolated: `growthforge_prod` DB owned by role `growthforge_prod` (dev uses
  `growthforge_dev` / `growthforge_app_dev`). No change to that separation.
- Set `DATABASE_URL` and `DIRECT_DATABASE_URL` to the `growthforge_prod` connection string.
- **Migration risk to validate:** the prod DB is on a different (older) migration track and
  already contains some Better Auth tables. Run the forward-only Drizzle migrations
  (`0000_baseline.sql`, `0001_better_auth.sql`) against a THROWAWAY copy of prod first and
  diff table/column drift. If the baseline conflicts, write an additive reconciliation
  migration (never a destructive down-migration). This is the single highest-risk step.

## 6. Wasabi production media bucket + least-privilege credentials

- Create a NEW bucket (e.g. `growthforge-prod-media`) - separate from dev's `growthforge-media`.
- Create a NEW Wasabi sub-user with a policy scoped to ONLY that bucket
  (`s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on
  `arn:aws:s3:::growthforge-prod-media/*`), not the dev or backup buckets.
- Set in prod `.env`:
  `DEFAULT_OBJECT_STORAGE_BUCKET_ID=growthforge-prod-media`,
  `OBJECT_STORAGE_ENDPOINT=https://s3.ca-central-1.wasabisys.com`,
  `OBJECT_STORAGE_REGION=ca-central-1`,
  `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- Remove the Supabase-style `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR`.

## 7. Stripe configuration + webhook routing

- `STRIPE_SECRET_KEY`: keep TEST mode for the controlled beta; live key only at real launch
  (requires owner approval - "no live billing").
- `STRIPE_WEBHOOK_SECRET`: leave BLANK; the managed webhook (stripe-replit-sync) supplies its
  own signing secret into `stripe._managed_webhooks`.
- `REPLIT_DOMAINS=usegrowthforge.com` so `findOrCreateManagedWebhook` registers
  `https://usegrowthforge.com/api/stripe/webhook` (verified working on dev at
  `https://dev.usegrowthforge.com/api/stripe/webhook`).
- Caddy prod route must proxy `/api/*` → `localhost:4002` (currently commented out; enabled only at launch).

## 8. Email + OAuth callback

- `RESEND_API_KEY` (prod key), `AUTH_FROM=noreply@usegrowthforge.com`.
- Google OAuth callback `https://usegrowthforge.com/api/auth/callback/google` (see §4).

## 9. Required env vars (names only - no secrets in this doc)

From the verified dev `.env`, minus Supabase legacy vars:
`APP_ENV`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`,
`OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REPLIT_DOMAINS`, `TOKEN_ENCRYPTION_KEY`,
`GOOGLE_GENAI_API_KEY`, `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`,
`GOOGLE_ADS_DEVELOPER_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `META_SCOPES`,
`RESEND_API_KEY`, `AUTH_FROM`, `ACTIVE_VIDEO_PROVIDER`.

(Do NOT carry over: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`.)

## 10. Build → deploy → health check → smoke test

1. `pnpm install --frozen-lockfile` + build API + frontend in `/home/ubuntu/prod/app-new`.
2. Update `growthforge-prod-api.service` `WorkingDirectory` to `/home/ubuntu/prod/app-new/artifacts/api-server`
   (keep `APP_ENV=production`, `PORT=4002`), then `systemctl daemon-reload && systemctl restart`.
3. Health: `curl -s https://usegrowthforge.com/api/healthz` → `{"status":"ok"}` (after Caddy route enabled).
4. Smoke (test-mode only): signup/login via Better Auth, create a project, generate a small
   content piece, confirm Wasabi upload lands in `growthforge-prod-media`, confirm `/api/stripe/products`.
5. Verify `usegrowthforge.com` still shows Coming Soon until the explicit launch approval
   (the app routes stay commented out; only `/api/*` may be conditionally enabled for smoke tests).

## 11. Rollback procedure

1. `systemctl stop growthforge-prod-api`; restore `WorkingDirectory` to the `.bak` dir.
2. If DB was migrated: `pg_restore` the predeploy dump into `growthforge_prod` (or restore the
   encrypted Wasabi backup - the drill in Phase 1 proved this restores cleanly in ~9s).
3. Revert Caddy to the Coming-Soon-only config (`caddy reload`).
4. Confirm `/api/healthz` (if applicable) + Coming Soon page both behave as before.

## 12. Coming Soon page stays untouched

- `usegrowthforge.com` remains the static "Coming Soon" until launch approval. The prod app
  routes in `/etc/caddy/Caddyfile` stay commented out. No DNS or public-page change is part of
  this promotion step.

## 13. Approval gates (require owner sign-off before execution)

- [ ] Approve migrating prod DB schema (after the dry-run drift diff is shown).
- [ ] Approve creating the prod Wasabi bucket + least-privilege sub-user.
- [ ] Approve prod `.env` contents (secrets supplied by owner or generated locally).
- [ ] Approve enabling `/api/*` on `usegrowthforge.com` for smoke tests (Coming Soon still public).
- [ ] Approve live Stripe key - only at real launch, not during beta.
