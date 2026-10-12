# GrowthForge - Production Deployment Runbook

This document describes how to safely take the Stage 1-4 social-first
Business/Creator/Hybrid release from `PUSHED - NOT DEPLOYED` to live production,
without losing track of completed work or marking anything deployed that isn't.

> **State at time of writing:** Stages 1, 2, 3, 3B, 4 are committed and pushed to
> `origin/main`. Migration `0001_p0_creator_sources.sql` exists but is **NOT applied**.
> Supabase is paused (billing/dunning). Nothing below is executed until explicitly
> authorized. Values marked `[VERIFY]` must be confirmed against the real
> environment before that step runs.

---

## 1. Current production architecture

- **Frontend** - Vite + React (Tailwind v4), build output `artifacts/growthforge/dist/public`.
  Served behind a reverse proxy that routes `/api/*` to the backend (single origin).
- **Backend** - Node + Express (ESM), esbuild-bundled to `artifacts/api-server/dist/index.mjs`.
  Runs on AWS Lightsail (pm2-managed). Uses Supabase Auth for the auth middleware.
- **Database** - Supabase Postgres (single project). Schema is managed by Drizzle ORM
  (`lib/db`), with migrations in `lib/db/migrations/`.
- **AI** - Google Gemini (via `@workspace/integrations-google-genai`), billing credits
  tracked by `lib/platformCredits.ts`.
- **Storage / integrations** - Supabase Storage, Stripe (billing), Meta (optional
  publishing). Not in the Stage 4 release path unless already configured.

---

## 2. Git commit and build verification

```bash
cd /home/ubuntu/projects/growthforge
git fetch origin && git checkout main && git pull
git log --oneline -10          # expect latest >= 49736f4 (Stage 4)

# Full local verification (no DB required for typecheck/build):
pnpm -C artifacts/api-server run typecheck
pnpm -C artifacts/growthforge run typecheck
pnpm -C artifacts/api-server run build
PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm -C artifacts/growthforge run build
pnpm -C artifacts/api-server run test   # expect 146 loaded tests passing; 3 files DB-blocked
```

The 3 DB-blocked test files (`publishRoute`, `statsRoute`, `stuckPublishRecovery`) will
fail to **load** without `DATABASE_URL`. That is expected until Section 12.

---

## 3. Supabase restoration / recovery prerequisites

1. Resolve the Supabase billing/dunning state in the Supabase dashboard.
2. Confirm the project is `Active` and the database endpoint is reachable.
3. Capture the current **connection string** (`DATABASE_URL`, pooled or direct) - `[VERIFY]`.
4. Confirm Supabase Auth keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
   still match the values in the Lightsail environment - `[VERIFY]`.

> Do **not** run DDL against the DB until backup + schema inspection (Sections 4-6)
> are complete.

---

## 4. Database backup creation and restore verification

1. Create a point-in-time backup in the Supabase dashboard, or:
   ```bash
   pg_dump "$DATABASE_URL" --format=custom --file=gf_backup_$(date +%Y%m%d_%H%M%S).dump
   ```
2. **Verify the backup restores** into a throwaway schema/database before trusting it:
   ```bash
   pg_restore --list gf_backup_*.dump | head -50   # dump is readable and well-formed
   # Then restore into a scratch Postgres and spot-check row counts.
   ```
3. Record the backup filename, checksum, and the restore verification result in the
   deployment register. A backup is **NOT** "verified" until step 2 succeeds.

---

## 5. Existing database schema inspection

```bash
cd /home/ubuntu/projects/growthforge
DATABASE_URL="$DATABASE_URL" pnpm -C lib/db exec drizzle-kit pull --config ./drizzle.config.ts
```

Review the pulled schema (`lib/db/src/schema/`) against the committed `lib/db/src/schema/`.
The critical question: **does production already contain the columns that migration
`0001` will add?** (e.g. `projects.website_url` nullable, `creator_profiles`,
`business_sources`, `analysis_sources`.) If production was previously managed with
`drizzle-kit push`, the answer may be "partially" - do not assume.

---

## 6. Safe baseline migration adoption

There is currently **no baseline (`0000_`) migration** - only `0001_p0_creator_sources`.
So the production migration history must be seeded safely:

1. From the inspected production schema, generate a baseline migration:
   ```bash
   DATABASE_URL="$DATABASE_URL" pnpm -C lib/db exec drizzle-kit generate --custom --name 0000_baseline
   ```
   (or hand-write `0000_baseline.sql` that represents the *current* production schema.)
2. Insert the baseline into the drizzle migration table **without executing its DDL**:
   ```sql
   INSERT INTO drizzle.__drizzle_migrations
     (hash, created_at)
   VALUES (gen_random_uuid(), now());
   ```
   Use the exact `hash` column semantics drizzle-kit expects - `[VERIFY]` against the
   drizzle-kit version in use (`0.31.10`).
3. Verify `pnpm -C lib/db run migrate` reports `0000_baseline` as already applied and
   **only** `0001_p0_creator_sources.sql` as pending.

> Never run `pnpm -C lib/db run push` or `push-force` against production.

---

## 7. Review and apply `0001_p0_creator_sources.sql`

1. Read `lib/db/migrations/0001_p0_creator_sources.sql` and its `.down.sql` line by line.
2. Confirm the columns/tables it creates are idempotent-safe relative to the pulled schema.
3. Apply in a transaction (drizzle-kit wraps each migration):
   ```bash
   DATABASE_URL="$DATABASE_URL" pnpm -C lib/db run migrate
   ```
4. Verify:
   ```sql
   SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;
   SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name='projects' AND column_name IN ('website_url','source_type','source_url','operating_model');
   ```
5. **Rollback path:** `0001_p0_creator_sources.down.sql` (run manually) - this is why the
   down migration exists and must be kept correct.

---

## 8. Backend deployment to AWS Lightsail

```bash
cd /home/ubuntu/projects/growthforge
pnpm -C artifacts/api-server run typecheck
pnpm -C artifacts/api-server run build          # -> artifacts/api-server/dist/index.mjs
# Copy dist to the Lightsail host - [VERIFY] the exact rsync/scp + target path:
# rsync -az artifacts/api-server/dist/ deploy@<lightsail-ip>:/opt/growthforge/api-server/dist/
```

The production process is assumed to run with `cwd = /home/ubuntu/projects/growthforge`
(repo root) because `localizationProfiles.json` is resolved from that cwd - verify the
config file exists at the expected path on the host.

---

## 9. Service restart and health checks

```bash
# [VERIFY] the pm2 process name
pm2 restart growthforge-api
pm2 logs growthforge-api --lines 50 --nostream
curl -sf http://localhost:3001/api/health    # [VERIFY] port; expect {"status":"ok"}
```

Confirm the process is `online` in `pm2 list`, not merely that the restart command exited 0.

---

## 10. Frontend build and deployment

```bash
cd /home/ubuntu/projects/growthforge
PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm -C artifacts/growthforge run build
# -> artifacts/growthforge/dist/public
# Copy to the static host / nginx root - [VERIFY]:
# rsync -az artifacts/growthforge/dist/public/ deploy@<lightsail-ip>:/opt/growthforge/public/
```

Confirm the reverse proxy still routes `/api/*` to the backend after any nginx reload.

---

## 11. Environment-variable validation

Verify the Lightsail environment has correct, non-stale values:

| Var | Check |
|-----|-------|
| `DATABASE_URL` | points at the **restored** Supabase project, reaches a live DB |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | match the active Supabase project |
| `GOOGLE_GENAI_API_KEY` / AI keys | present and valid |
| `STRIPE_*` | present (billing) |
| `PORT` / `BASE_PATH` | frontend build values match reverse proxy |

---

## 12. Database-dependent integration testing

With a live `DATABASE_URL` (staging Supabase first), run the previously-blocked tests:

```bash
cd /home/ubuntu/projects/growthforge
DATABASE_URL="..." pnpm -C artifacts/api-server run test
```

Expected: `publishRoute`, `statsRoute`, `stuckPublishRecovery` now **load**, and the
full suite passes. Also exercise the source-management auth path (`GET/POST
/projects/:id/sources`) and creator/hybrid onboarding against the real schema.

---

## 13. Production smoke test plan

Run in this order. "Local" = can run now without production; "DB" = needs a live
(restored) database; "Prod" = needs deployed production.

| # | Test | Where | Pass criterion |
|---|------|-------|----------------|
| 1 | Existing website-based onboarding | DB/Prod | website project created, `websiteUrl` set, analysis reaches website |
| 2 | Instagram-first business onboarding | DB/Prod | `sourceType=instagram`, `sourceUrl` saved, declared description persists |
| 3 | TikTok-first creator onboarding | DB/Prod | `operatingModel=creator`, `creator_profiles` row created |
| 4 | YouTube creator onboarding | DB/Prod | creator profile + source persisted, no auto-scrape implied |
| 5 | Hybrid creator-business onboarding | DB/Prod | business + creator fields both persisted |
| 6 | Manual onboarding (no website) | DB/Prod | `websiteUrl=NULL`, project still created and analyzable |
| 7 | Business analysis generation | Prod | 14-field analysis returns from Gemini |
| 8 | Creator analysis generation | Prod | creator labels shown; analysis grounded in description |
| 9 | Source management | DB/Prod | add/list sources; duplicate returns 409; non-owner returns 403/404 |
| 10 | Historical analysis versioning | Prod | new analysis creates a new `analysis_sources` snapshot, old one intact |
| 11 | Content generation | Prod | content returns; `targetLocale=en-NG` injects Nigeria directives |
| 12 | Video-generation availability | Prod | video render path responds (not a mock) |
| 13 | Forge AI project grounding | Prod | chat uses project identity (website → source → name) |
| 14 | Existing Meta publishing | Prod | unchanged behavior preserved |
| 15 | Billing / subscription entitlements | Prod | plan gating + credit deduction unchanged |
| 16 | Nigeria locale + currency | Local/Prod | `.ng` → `en-NG`; analysis/strategy/content receive NGN/Africa-Lagos |

Do **not** report tests 7-15 as passing from mocked calls; each must hit the real
dependency (Gemini, renderer, Meta, Stripe).

---

## 14. Billing entitlement verification

1. Confirm Stripe webhook / checkout still resolves to the live plan (`starter`, `growth`, `agency`).
2. Confirm platform-credit deduction (`lib/platformCredits.ts`) is intact after restart.
3. Confirm white-label gating (`canWhiteLabel`) still keys off `isOwner` or plan.
4. Record the current subscription/billing state and any changes in the register.

---

## 15. Rollback and recovery procedures

- **Code rollback (backend/frontend):** redeploy the previous known-good commit; restart
  the pm2 process; re-run the health check. No DB state is changed by a code redeploy.
- **Migration rollback:** apply `lib/db/migrations/0001_p0_creator_sources.down.sql`
  manually, then restore the pre-migration backup if needed.
- **Full recovery:** restore the verified backup from Section 4, redeploy code, restart,
  re-run Sections 12-14.

---

## 16. Final deployment-register updates

After each of the above completes, update `docs/DEPLOYMENT_REGISTER.md`:
- Flip each stage from `PUSHED - NOT DEPLOYED` to `PRODUCTION VERIFIED` **only** after its
  smoke test passes in production.
- Record the migration application, backup verification, commit hash deployed, and smoke
  results in the consolidated release entry.

---

## Production authorization boundary

Restoring/provisioning Supabase, applying migrations to production, changing
infrastructure, restarting production services, deploying, and modifying live billing are
**not** authorized until separately and explicitly approved.
