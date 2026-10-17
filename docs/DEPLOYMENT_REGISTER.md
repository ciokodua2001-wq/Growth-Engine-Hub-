# GrowthForge - Deployment Register

Persistent record of every development stage from implementation through production
verification. A stage is **not fully delivered** until it is deployed, verified on the
live platform, and recorded here as `PRODUCTION VERIFIED`.

A stage never disappears from this register because development moved forward. It is
closed only when it is deployed+verified, explicitly cancelled by the owner, or replaced
by a newer implementation with documented evidence.

## Status vocabulary

| Status | Meaning |
|---|---|
| NOT STARTED | Queued, no code |
| IN DEVELOPMENT | Code in progress |
| CODE COMPLETE | Code done, tests run, not yet committed |
| PUSHED - NOT DEPLOYED | Committed + pushed to `origin/main`, not on any live env |
| READY FOR STAGING | All code+test+migration prerequisites met for staging |
| STAGING VERIFIED | Verified on a staging environment |
| READY FOR PRODUCTION | Staging verified + rollback plan ready |
| PRODUCTION DEPLOYED | Live, smoke tests not yet confirmed |
| PRODUCTION VERIFIED | Live + smoke-tested + recorded |
| BLOCKED | Blocked (name the blocker) |

## Deployment workflow

1. Implement → 2. Test → 3. Commit → 4. Push → 5. Record status → 6. Validate in
staging → 7. Verify DB migration prerequisites → 8. Prepare deploy + rollback →
9. Request explicit production approval → 10. Deploy after authorization →
11. Production smoke tests → 12. Mark `PRODUCTION VERIFIED` only after live success.

---

## Stage 1 - Social-first + creator/hybrid schema foundation

- **Status:** `PUSHED - NOT DEPLOYED`
- **Started:** P0 code-only implementation (2025)
- **Features:** nullable `projects.websiteUrl`; `projects.sourceType` / `sourceUrl` /
  `operatingModel`; new `business_sources`, `creator_profiles`, `analysis_sources`
  tables; `business_analysis.editedAt`; versioned migration SQL (UP + rollback);
  `drizzle generate`/`migrate` scripts.
- **Files changed:**
  - `lib/db/src/schema/projects.ts`
  - `lib/db/src/schema/analysis.ts`
  - `lib/db/src/schema/businessSources.ts` (new)
  - `lib/db/src/schema/creatorProfiles.ts` (new)
  - `lib/db/src/schema/analysisSources.ts` (new)
  - `lib/db/src/schema/index.ts`
  - `lib/db/migrations/0001_p0_creator_sources.sql` (new)
  - `lib/db/migrations/0001_p0_creator_sources.down.sql` (new)
  - `lib/db/package.json`
  - `artifacts/api-server/src/routes/content.ts` (pre-existing import fix)
- **Commits:** `e6d1952` (schema), `50f515d` (content-route import fix)
- **GitHub push:** ✅ pushed to `origin/main` (`1210e45..50f515d`)
- **Migration:** `CREATED - NOT APPLIED` (`0001_p0_creator_sources.sql`)
- **Testing:** `typecheck:libs` ✅ · `api-server typecheck` ✅ (0 errors) · `api-server
  build` (esbuild) ✅ · tests: 40/40 loaded pass, 4 files infra-blocked (DATABASE_URL/config)
- **Staging:** `NOT STARTED`
- **Production:** `NOT DEPLOYED`
- **Blockers:** Supabase paused → no staging DB to apply/verify migration; schema-dependent
  backend code must not ship before the migration is applied.
- **Rollback:** run `0001_p0_creator_sources.down.sql` (guarded: `SET NOT NULL` fails if
  website-less projects exist - backfill sentinel or keep nullable first).

---

## Stage 2 - Backend null-safety + unified source ingestion + source-aware APIs

- **Status:** `PUSHED - NOT DEPLOYED`
- **Features:** `projectIdentityLabel()` null-safe identity helper (prompts/email/SEO never
  render "null"); SEO tools require a real website (no fake `example.com`); unified
  `businessSourceIngestor` (website reuses fetcher; social/manual use declared content, no
  scraping); source-aware `POST /onboarding` + `POST /projects/:id/analyze`; append-only
  `business_analysis` versioning + immutable `analysis_sources` snapshots; operating-model
  aware analysis prompt (business/creator/hybrid, never-invent + not-applicable/unknown);
  dashboard `analysisStatus` now deterministic latest.
- **Files changed:**
  - `artifacts/api-server/src/lib/projectContext.ts`
  - `artifacts/api-server/src/lib/contentGenerators.ts`
  - `artifacts/api-server/src/lib/emailNotifier.ts`
  - `artifacts/api-server/src/lib/businessSourceIngestor.ts` (new)
  - `artifacts/api-server/src/lib/__tests__/businessSourceIngestor.test.ts` (new)
  - `artifacts/api-server/src/routes/competitors.ts`
  - `artifacts/api-server/src/routes/seo-tools.ts`
  - `artifacts/api-server/src/routes/analysis.ts`
  - `artifacts/api-server/src/routes/onboarding.ts`
  - `artifacts/api-server/src/routes/projects.ts`
  - `lib/api-spec/openapi.yaml` + regenerated `lib/api-zod/**` and `lib/api-client-react/**`
- **Commits:** `0af5ca5` (null-safety), `b276b1b` (ingestor), `a3a2301` (source-aware APIs + versioning)
- **GitHub push:** ✅ pushed to `origin/main` (`b276b1b..a3a2301`)
- **Migration dependency:** Stage 1 migration `0001_p0_creator_sources.sql` (`CREATED - NOT APPLIED`)
- **Testing:** `api-server typecheck` ✅ (0 errors) · `api-server build` (esbuild) ✅ ·
  tests 40/40 loaded pass (5 new ingestor tests) · 4 files infra-blocked:
  `publishRoute`, `statsRoute`, `stuckPublishRecovery` (need DATABASE_URL), `localization` (config path)
- **Staging:** `NOT STARTED`
- **Production:** `NOT DEPLOYED`
- **Blockers:** Stage 1 DB migration not applied (Supabase paused); frontend (Stage 3)
  not yet updated (backend is null-safe but UI still assumes websiteUrl); schema-dependent
  backend must not ship before the migration is applied.
- **Rollback:** revert commits `a3a2301`, `b276b1b`, `0af5ca5` (code-only; no DB state).

---

## Stage 3 - Frontend null-safety + social-first/creator onboarding

- **Status:** `PUSHED - NOT DEPLOYED`
- **Features:** frontend `projectIdentityLabel()` display helper; nullable `websiteUrl`
  handling (dashboard/overview/analysis/settings/admin); social-first onboarding wizard
  (operating model → source → details → confirmation); creator-profile write path
  extended (contentThemes, brandVoice/tone, selfReportedStats); creator/hybrid field labels
  on the analysis page.
- **Files changed:**
  - `artifacts/growthforge/src/lib/projectIdentity.ts` (new)
  - `artifacts/growthforge/src/pages/onboarding.tsx` (rewritten)
  - `artifacts/growthforge/src/pages/dashboard.tsx`
  - `artifacts/growthforge/src/pages/project/overview.tsx`
  - `artifacts/growthforge/src/pages/project/analysis.tsx`
  - `artifacts/growthforge/src/pages/project/settings.tsx`
  - `artifacts/growthforge/src/pages/admin/projects.tsx`
  - `artifacts/api-server/src/routes/onboarding.ts`
- **Commits:** `6967582` (null-safety), `52b9167` (onboarding), `4998565` (labels/settings/fix)
- **GitHub push:** ✅ pushed to `origin/main`
- **Migration dependency:** Stage 1 migration `0001_p0_creator_sources.sql` (`CREATED - NOT APPLIED`)
- **Testing:** frontend typecheck ✅ (0 errors) · frontend build ✅ · backend typecheck ✅ ·
  backend build ✅ · backend tests 142/142 loaded pass (3 files DB-blocked)
- **Staging:** `NOT STARTED`
- **Production:** `NOT DEPLOYED`
- **Blockers:** Stage 1 DB migration not applied; no DB for live onboarding/analysis verification.
- **Rollback:** revert `6967582`, `52b9167`, `4998565` (code-only).

---

## Stage 3B - Source management + verification

- **Status:** `PUSHED - NOT DEPLOYED`
- **Features:** `GET/POST /projects/:id/sources` (ownership-checked, duplicate-safe,
  provenance-preserving, no auto-import); settings "Connected Sources" UI; localization
  test config-path fix.
- **Files changed:**
  - `artifacts/api-server/src/routes/sources.ts` (new)
  - `artifacts/api-server/src/routes/index.ts`
  - `artifacts/api-server/src/lib/localization.ts`
  - `artifacts/growthforge/src/pages/project/settings.tsx`
- **Commits:** `2857097` (endpoints), `4998565` (UI + test fix)
- **GitHub push:** ✅ pushed to `origin/main`
- **Testing:** backend typecheck ✅ · backend build ✅ · frontend typecheck ✅ ·
  frontend build ✅ · backend tests 142/142 loaded pass (3 files DB-blocked:
  `publishRoute`, `statsRoute`, `stuckPublishRecovery` need DATABASE_URL)
- **Staging:** `NOT STARTED`
- **Production:** `NOT DEPLOYED`
- **Blockers:** DB-dependent integration tests (source auth, creator onboarding) need a live DB.
- **Rollback:** revert `2857097`, `4998565`.

---

## Stage 4 - Release preparation + Nigeria localization

- **Status:** `PUSHED - NOT DEPLOYED`
- **Features:** `en-NG` locale (NGN currency, Africa/Lagos, Nigerian market context,
  no single-dialect assumption, local + international audiences); `.ng` ccTLD detection;
  English-aware localization directive path; locale threaded into analysis/persona/strategy;
  sources endpoints in OpenAPI + regenerated clients; settings uses generated source hooks;
  creator-appropriate analysis section headings; production runbook + smoke test plan.
- **Files changed:**
  - `artifacts/api-server/config/localizationProfiles.json`
  - `artifacts/api-server/src/lib/localization.ts`
  - `artifacts/api-server/src/utils/urlLocaleDetector.ts`
  - `artifacts/api-server/src/routes/analysis.ts`
  - `artifacts/api-server/src/lib/__tests__/localizationNigeria.test.ts` (new)
  - `lib/api-spec/openapi.yaml`
  - `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*` (regenerated)
  - `artifacts/growthforge/src/pages/project/settings.tsx`
  - `artifacts/growthforge/src/pages/project/analysis.tsx`
  - `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` (new)
- **Commits:** `f6043ee` (localization), `49736f4` (P0 gaps)
- **GitHub push:** ✅ pushed to `origin/main`
- **Testing:** frontend + backend typecheck 0 errors · backend build ✅ · frontend build ✅ ·
  backend tests 146/146 loaded pass (3 files DB-blocked) · Nigeria localization tests 4/4
- **Staging:** `NOT STARTED`
- **Production:** `NOT DEPLOYED`
- **Blockers:** Supabase paused; migration not applied; no production access.
- **Rollback:** revert `f6043ee`, `49736f4` (code-only; localization profile is data-only).

---

## Consolidated release entry - social-first Business/Creator/Hybrid (P0)

- **Commit range:** `0af5ca5` (Stage 2A) → `49736f4` (Stage 4)
- **Migration dependencies:** `0001_p0_creator_sources.sql` (+ `.down.sql`) - NOT applied
- **Rollout sequence:**
  1. Restore Supabase + verify backup (runbook §3-4)
  2. Inspect schema + adopt baseline migration (runbook §5-6)
  3. Apply `0001` + verify (runbook §7)
  4. Deploy backend + health check (runbook §8-9)
  5. Deploy frontend + proxy check (runbook §10)
  6. Env validation + DB integration tests (runbook §11-12)
  7. Production smoke tests 1-16 (runbook §13)
  8. Billing entitlement verification (runbook §14)
- **Smoke tests:** 16-item plan in `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` §13
- **Rollback plan:** code redeploy to last good commit; `0001` down migration; full restore
  from verified backup (runbook §15)
- **Production approval status:** ⛔ NOT AUTHORIZED - awaiting explicit authorization before
  restore / migrate / deploy / restart / billing changes.

---

## Stage 5 - Production recovery and deployment

> **CORRECTION (Phase 5A superseded - verified via shared tabs):** Supabase `growthforge-prod`
> (ref `hewadpjwvgntrimfmutu`) is **PAUSED, not deleted**. Dashboard shows: "All data,
> including backups and storage objects, remains safe. You can resume this project from the
> dashboard until 06 Nov 2027." Root cause: **outstanding invoices** (billing) on the
> "Strapli Technologies Inc." org (Free plan); 3 projects paused (Global-EdTech,
> growthforge-prod, strap-bank). The earlier DNS NXDOMAIN / pooler "tenant not found" were
> paused-project artifacts, not deletion. **Recovery = pay invoice + click "Resume project"
> (data intact, no data loss).**
>
> **Lightsail finding (V2 partial):** production `usegrowthforge.com` (and www/dev) resolve to
> `15.222.206.60` = **`growthforge-box-8gb`** (8 GB RAM / 2 vCPU / 160 GB SSD, Montreal
> ca-central-1). 4 running instances: `growthforge-box` (512 MB Nano, 99.79.78.143),
> `growthforge-box-8gb` (8 GB, 15.222.206.60), `strapli-web` (2 GB, 15.223.91.60),
> `quantivarian-dev` (2 GB, 52.60.215.106). Usage metrics + process details still pending SSH.


- **Status:** `IN PROGRESS - BLOCKED` (Phase 5A finding: project deleted)
- **Phase 5A finding:** Supabase project `hewadpjwvgntrimfmutu` (growthforge-prod) is
  **DELETED**, not paused. Evidence (read-only checks, no destructive action):
  - `hewadpjwvgntrimfmutu.supabase.co` (API host) → DNS `NXDOMAIN`
  - `db.hewadpjwvgntrimfmutu.supabase.co` (direct DB host) → DNS `NXDOMAIN`
  - Pooler `aws-0-ca-central-1.pooler.supabase.com:6543` (shared infra, TCP open) →
    `FATAL: (ENOTFOUND) tenant/user not found`
- **Root cause:** billing/dunning → org downgrade → project paused then deleted
  (Supabase exit). Postgres + Auth users + Storage objects are all gone unless an
  external backup exists.
- **Owner action required:**
  1. Confirm deletion in the Supabase dashboard (project list / deleted-projects).
  2. Check for a "Restore" option (only if within Supabase's retention window).
  3. Locate any external backup (none found in repo - no `.dump`/`pg_dump` artifacts).
  4. If unrecoverable, authorize a NEW project + full schema re-apply from migrations
     (data loss unless a backup is found elsewhere).
- **Backup status:** NOT VERIFIED - no backup file found; no restoration path confirmed.
- **Migration status:** `0001_p0_creator_sources.sql` still `CREATED - NOT APPLIED`;
  a baseline migration must be generated for whatever DB is eventually used.
- **No action taken:** inspection only. No payments, plan changes, DB creation,
  migration, deploy, or restart.
- **Stage A direction (approved for planning):** local Postgres on Lightsail (Small $10) +
  Better Auth (replaces Supabase Auth) + Cloudflare R2 (replaces Supabase Storage); preserve
  Node API / frontend / AI / video / Stripe. Detail in `docs/STAGE_A_IMPLEMENTATION_PLAN.md`.
- **Execution status:** PLANNING ONLY. Not yet authorized to resize/provision/migrate/deploy.
- **Wasabi object storage (inspection complete, pending approval):** account active (owner
  `theoctavid`); current invoice $3.28 (9/30-10/29); 15.69 GB active + 36.47 GB deleted
  storage, 13,330 objects; 2 existing buckets in `eu-central-1` (`quantivarian-vod`,
  `strapli-tech-main`); 2 access keys (Root Account Key, `wawu-quantivarian-vod`).
  **Proposed:** new private bucket `growthforge-media` in `ca-central-1` (Toronto, near the
  Montreal Lightsail box) + a new least-privilege access key scoped to that bucket only.
  Provider-neutral S3 adapter via `@aws-sdk/client-s3` (endpoint/region/creds in env vars).
  **Status:** code integration DONE (provider-neutral S3 adapter `objectStorage.ts` +
  `wanRenderer` passthrough, 5 unit tests, typecheck clean - commit `675f214`). Bucket/key
  creation is BLOCKED on the Wasabi console UI: the create-bucket dialog's form fields
  (name/region/Next) are not reachable via the text-based device operations (React portal
  elements aren't exposed to fill/click). Owner must create the `growthforge-media` bucket
  (ca-central-1) + a `growthforge-prod` key manually, or grant a more capable console path.
- **Companion-app tab access (V2 attempt):** device connected; `browser_attached_list_tabs`
  lists 4 shared tabs (Lightsail ca-central-1, Supabase org, AWS S3, AWS Console Home), but
  `browser_attached_snapshot`/`screenshot`/`navigate`/`click` all return `success:false` (no
  error) for every parameter shape tried - tab contents could NOT be read. V2 remains BLOCKED
  until the browser is confirmed open on the Windows PC or the owner pastes the Lightsail
  metrics directly.
- **Infrastructure design:** `docs/INFRASTRUCTURE_ARCHITECTURE.md` - cost-first
  three-stage plan. Stage A: single Lightsail Small ($10/mo) + local Postgres +
  better-auth ($0) + Cloudflare R2 ($0 egress). Pending owner decision on the DB
  recovery path (recover vs re-create) and the auth provider (better-auth vs Supabase).

---

## Nigeria launch dependencies (mandatory before launch)

| Dependency | Owner stage | Status |
|---|---|---|
| `en-NG` localization profile | P1 | complete, pending deploy (Stage 4) |
| `.ng` ccTLD detection | P1 | complete, pending deploy (Stage 4) |
| NGN currency formatting | P1 | complete, pending deploy (Stage 4) |
| `Africa/Lagos` time zone | P1 | complete, pending deploy (Stage 4) |
| Nigerian market intelligence | P1 | complete, pending deploy (Stage 4) |
| Creator + hybrid support | P0 | backend + frontend complete, pending deploy |
| Social-first onboarding | P0 | backend + frontend complete, pending deploy |
| Database backup verification | gate | NOT STARTED (BLOCKED - DB paused) |
| Billing entitlement consistency | gate | NOT STARTED |
| Production migration safety | gate | BLOCKED - DB paused (baseline adoption pending) |
| Live end-to-end verification | gate | NOT STARTED |

Meta/YouTube account enrichment: **optional** for initial launch.

---

## Stage A - Wasabi object storage: bucket + key + security audit (2026-10-12)

- **Status:** `BLOCKED` (least-privilege key rotation blocked on Wasabi console UI automation)
- **Bucket:** `growthforge-media` - ✅ CREATED in `ca-central-1` (private / Default access).
  Verified live via `list_buckets` (returns `growthforge-media`, `quantivarian-vod`,
  `strapli-tech-main`).
- **Access key:** Root Account Key `GAVY1...LSVOQ` - ⚠️ created but **exposed in the chat
  report**; treated as compromised and pending rotation.
- **Least-privilege key:** `BLOCKED` - the Wasabi "Create User" wizard's "Type of Access"
  (Programmatic/Console) selector and "Next" button are custom React components with no
  native radio/checkbox input, so they are not reachable via the device's browser
  operations (text/selector clicks land on the dialog container). Same class of blocker as
  the earlier create-bucket dialog.
- **Direct S3 smoke test (boto3, not app-level):** ✅ 5/5 - list_buckets, put_object,
  get_object (byte-verified), presigned URL, delete_object against
  `s3.ca-central-1.wasabisys.com`. This validates the *credentials* and *bucket* only.
- **Application integration:** `CODE COMPLETE` only - `artifacts/api-server/src/lib/objectStorage.ts`
  is a provider-neutral S3 adapter reading `OBJECT_STORAGE_*` env vars. `NOT DEPLOYED`; no
  live process uses it.
- **Credential leak check:** ✅ no credentials in git-tracked files (`git grep` clean);
  credentials reside only in gitignored `.env` files.
- **Production restart audit:** ❌ NO service was restarted. `pm2 list` shows only
  `quantivarian-qa` and `strap-bank`; there is no `growthforge`/`api-server` process. NO
  deployment occurred. A prior agent report incorrectly claimed build/commit/restart
  completed - those claims were false and are retracted here.
- **Actual deployed commit:** none deployed; `HEAD` = `b048dd4` (docs-only).
- **PostgreSQL replacement:** `NOT STARTED` (Supabase paused; Stage A local Postgres on
  Lightsail is PLANNING ONLY).
- **Better Auth replacement:** `NOT STARTED`.
- **Outstanding production blockers:** DB migration `0001_p0_creator_sources.sql` still
  `CREATED - NOT APPLIED`; no staging/production environment; Wasabi least-privilege key
  rotation blocked on console UI.

---

## Stage A - Wasabi key deactivation + production server audit (2026-10-12, update)

- **Exposed key containment:** Root Account Key `GAVY1...LSVOQ` → **DEACTIVATED** (Active switch
  off; NOT deleted). Verified two ways: (1) console shows the key status as `Inactive`;
  (2) a direct S3 `list_buckets` with that key now fails `InvalidAccessKeyId`. The original
  root key `X25KD5...` and `wawu-quantivarian-vod` `YMX3...` remain `Active` (untouched).
- **Dependency check (before deactivation):** `search_projects` across all registered projects
  found no reference to `GAVY1...LSVOQ`; a full `/home/ubuntu` grep found the key only in the
  GrowthForge `.env`. Strap Bank / Quantivarian / other apps do NOT use it.
- **Production server (`growthforge-box-8gb` = `growthforge-prod` @ `15.222.206.60`): NOT offline.**
  The earlier "no pm2 → offline" claim was WRONG (prod uses systemd on a separate Lightsail box).
  Read-only SSH verified:
  - systemd: `caddy` (active), `growthforge-dev-api` (active, :4001), `growthforge-prod-api`
    (active, :4002). Both API processes run `node dist/index.mjs`.
  - Caddy: `dev.usegrowthforge.com` → full app (basic-auth gated) → `localhost:4001`;
    `usegrowthforge.com` → static "Coming Soon" (no API proxy); `www` → redirect. The
    "LAUNCHED" block (→ :4002) is still commented out.
  - Listening: 22, 80, 443, 2019 (caddy admin), 4001 (dev API), 4002 (prod API).
  Prod env uses `SUPABASE_S3_*` + legacy `WASABI_ACCESS_KEY`/`WASABI_SECRET_KEY` (a DIFFERENT
    key; the exposed `GAVY1...LSVOQ` is NOT present anywhere on the box). The new `OBJECT_STORAGE_*`
    adapter is NOT yet deployed there.
- **Least-privilege `growthforge-prod` sub-user + key rotation - COMPLETE (2026-10-16):**
  - Custom policy `growthforge-media-least-privilege` created
    (`arn:aws:iam::100000528988:policy/growthforge-media-least-privilege`): `s3:ListBucket` on
    `arn:aws:s3:::growthforge-media` + `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on
    `arn:aws:s3:::growthforge-media/*`. No other resource is allowed.
  - Sub-user `growthforge-prod` created with **Programmatic (API) access**, Console access
    **No**, MFA not required; the policy attached (0 groups).
  - Replacement access key minted: `ABUU54...ART55` (secret stored in gitignored `.env` only).
  - Verified with AWS CLI against `s3.ca-central-1.wasabisys.com`:
    - ✅ `list-objects-v2` on `growthforge-media` (allowed)
    - ✅ `put-object` + `get-object` (byte-verified round-trip) on `growthforge-media`
    - ✅ presigned GET URL → HTTP 200
    - ✅ `list-buckets` → `AccessDenied` (no `s3:ListAllMyBuckets`)
    - ✅ `list-objects-v2` + `put-object` on `quantivarian-vod` (other bucket) → `AccessDenied`
    - ✅ `delete-object` cleanup of the test key
  - `.env` rotated: `OBJECT_STORAGE_ACCESS_KEY_ID`/`OBJECT_STORAGE_SECRET_ACCESS_KEY` and
    `WASABI_ACCESS_KEY_ID`/`WASABI_SECRET_ACCESS_KEY` now hold `ABUU54...ART55`; `GAVY1...LSVOQ`
    removed from `.env` (0 remaining occurrences). `.env` is gitignored (not committed).
  - Old exposed key `GAVY1...LSVOQ` remains **DEACTIVATED** (not deleted).

---

## Stage A - Phase 1 storage integration audit (2026-10-16, code + read-only SSH)

No services were changed or restarted. Findings:

- **Source is fully migrated** to `OBJECT_STORAGE_*` (Wasabi): `grep SUPABASE_S3` over
  `artifacts/api-server/src/` → **0 hits**.
- **Compiled `dist/index.mjs` is STALE**: still contains 7 `SUPABASE_S3_*` references in the
  Wan/Vast.ai renderer S3 passthrough. Both dev and prod run `node dist/index.mjs`, so the
  deployed video-render upload path is **not yet** on the Wasabi endpoint.
- **Adapter capabilities** (`lib/objectStorage.ts`): single-shot `PutObject` (no multipart),
  presigned GET/PUT/DELETE/HEAD via SigV4 (≤7 days), `ContentType` metadata only,
  `HeadObject` exists-check, S3 passthrough override for external workers. The scoped policy's
  `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject`/`s3:ListBucket` cover every operation the
  code performs.
- **Env var status (verified via `systemctl cat` + EnvironmentFile, values redacted):**
  - `growthforge-dev-api` `/home/ubuntu/dev/app/.env`: has `SUPABASE_*` (dead),
    `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `ACTIVE_VIDEO_PROVIDER`; **NO** `OBJECT_STORAGE_*`,
    `SUPABASE_S3_*`, `WASABI_*`.
  - `growthforge-prod-api` `/home/ubuntu/prod/app/.env`: has `SUPABASE_*` (dead),
    `DEFAULT_OBJECT_STORAGE_BUCKET_ID`; **NO** `OBJECT_STORAGE_*`, `SUPABASE_S3_*`, `WASABI_*`,
    `ACTIVE_VIDEO_PROVIDER`, `VAST_AI_*`.
  - Net effect: object storage is **not functional on either box** (bucket name set but
    credentials missing → adapter throws "Object storage not configured"). Supabase Auth/DB
    are dead (Supabase deleted).
- **Env var roles:** `OBJECT_STORAGE_*` (new - main adapter + Wan in source) · `SUPABASE_S3_*`
  (legacy Supabase Storage passthrough, still present in the stale dist) · `WASABI_*` (legacy,
  present only in gitignored `.env`, referenced by no source code).
- **Migrations:** only `0001_p0_creator_sources.sql` (+`.down.sql`); no `0000_baseline`.
- **Better Auth:** 0 references in source - auth is still `supabaseAuth.ts` / `@supabase/auth-js`.

---

## Stage A - Phase 2 development-only Wasabi deployment (2026-10-17, COMPLETE)

- **Build artifact:** Rebuilt `artifacts/api-server/dist/index.mjs` (commit `945376b`). Removed `@aws-sdk/*` from `build.mjs` `external` list so `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are bundled cleanly inside `dist/index.mjs` (6.6 MB). Re-verified: `grep SUPABASE_S3 dist/index.mjs` = **0**.
- **Predeployment backup:** Remote backups created at `/home/ubuntu/dev/backups/dist_20261017_040610` and `/home/ubuntu/dev/backups/env_20261017_040610` (chmod 600) on `growthforge-box-8gb` (`15.222.206.60`).
- **Development `.env` update:** Updated `/home/ubuntu/dev/app/.env` with `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, and `DEFAULT_OBJECT_STORAGE_BUCKET_ID=growthforge-media`. Secrets injected without logging.
- **Restart:** `sudo systemctl restart growthforge-dev-api`.
- **Status:** `growthforge-dev-api` is **active (running)** on PID 202782, listening on port `:4001`.
- **Health checks:** `http://localhost:4001/api/healthz` → `200 OK {"status":"ok"}`. `https://dev.usegrowthforge.com/api/healthz` → `200 OK {"status":"ok"}`.
- **Wasabi credential verification:** Direct S3 put/get/presign-GET/presign-PUT/delete/cross-bucket-denial verified using the new scoped key `ABUU54...ART55`.
- **Blocked HTTP endpoints:** Higher-level HTTP routes requiring database queries (e.g., project uploads/analysis) are blocked by the paused Supabase Postgres instance (`tenant/user not found`), as expected until Phase 3 local PostgreSQL cutover.
- **Production isolation:** `growthforge-prod-api`, Caddy, and production DNS remained completely untouched.

---

## Stage A - Phase 3A PostgreSQL baseline (2026-10-17, CODE COMPLETE + locally verified)

- **Correction recorded:** Supabase is **PAUSED** (due to unpaid invoices), not deleted. Historical data remains potentially recoverable later.
- **Schema inventory:** 28 schema files → **53 tables**, **41 foreign keys**, **73 indexes**, **47 sequences**, **0 enums** (enum-like fields are `text`).
- **Baseline:** generated natively via `drizzle-kit generate` → `lib/db/migrations/0000_baseline.sql` + `meta/_journal.json` + `meta/0000_snapshot.json`. Added `out: "./migrations"` to `drizzle.config.ts` (previously unset, so `migrate` would have looked in `./drizzle` and found nothing).
- **0001 resolution:** `0001_p0_creator_sources.sql` is fully baked into the baseline (the current schema already contains `source_type`/`operating_model`/`business_sources`/`creator_profiles`/`analysis_sources`). Archived to `lib/db/migrations-superseded/` so it is NOT re-applied. No object duplication.
- **Local validation (fresh Postgres 16):**
  - `drizzle-kit push` → 53 tables (schema-from-source cross-check).
  - `drizzle-kit migrate` against a fresh DB → "migrations applied successfully"; `drizzle.__drizzle_migrations` records the baseline hash; 53 tables / 41 FKs / 73 indexes / 47 sequences.
  - `pg_dump --schema-only` round-trip applied to a second fresh DB with 0 errors.
- **Lightsail DB config (PLAN, not executed - requires approval):** dedicated role `growthforge_app` (scram-sha-256 password), database `growthforge`, `DATABASE_URL=postgresql://growthforge_app:<pw>@127.0.0.1:5432/growthforge` (+ `DIRECT_DATABASE_URL` same), UFW blocks external 5432, `pg_hba.conf` localhost = `scram-sha-256`.
- **Encrypted off-server backups (PLAN):** nightly `pg_dump -Fc` → `gpg --symmetric` (key from env, not in repo) → upload to the existing Wasabi `growthforge-media` bucket under `backups/` (30-day retention). Restore drill = decrypt + `pg_restore --clean` into a throwaway DB + row-count check.
- **NOT done yet:** installing Postgres on Lightsail, creating the live role/DB, and the backup cron - all require explicit approval.

---

## Stage A - Phase 3B Better Auth backend (2026-10-17, CODE COMPLETE + locally verified)

- **48 vs 53 table reconciliation:** the earlier "48 tables" figure was a grep undercount. The schema has **53 tables** - 48 are defined with single-line `pgTable("name", ...)` and 5 use a multi-line `pgTable(` call (name on the next line): `business_sources`, `analysis_sources`, `object_acl_policies`, `plan_usage`, `trial_usage`. No schema anomaly; 53 is authoritative (matches the fresh DB and `drizzle-kit generate`).
- **Auth schema:** new `lib/db/src/schema/auth.ts` adds Better Auth's `user`/`session`/`account`/`verification` tables (Better Auth owns auth/session state; the app `users` table stays the profile source of truth keyed by the same UUID). No collision with `users`/`team_members`/`meta_page_sessions`.
- **Migration:** `0001_better_auth.sql` (drizzle-native) + meta snapshot/journal. Replay verified from empty: `drizzle-kit migrate` applies `0000`→`0001` cleanly → **57 tables**, 2 journal rows.
- **Auth instance** (`api-server/src/lib/betterAuth.ts`): `better-auth` 1.7.10 + `drizzleAdapter` (pg). Email/password enabled; Google OAuth wired conditionally (`GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET`); `sendResetPassword` + `sendVerificationEmail` hooks present but **logged, not yet sent via Resend** (TODO).
- **Middleware** (`supabaseAuth.ts`): now verifies the Better Auth session cookie via `auth.api.getSession` (no Bearer/network round-trip). Kept the exact `getAuth(req)`/`req.auth = {userId, sessionClaims}` contract so all ~15 downstream call sites are unchanged. Authorization (`authz.ts`) remains server-side.
- **Routes:** `toNodeHandler(auth)` mounted at `/api/auth/*` (sign-up, sign-in, sign-out, session, reset-password, verify-email, OAuth callbacks) before the session middleware. Existing `/auth/provision`, `/auth/start-trial`, `/auth/me` unchanged.
- **Supabase removal:** deleted `supabaseClient.ts` + dropped `@supabase/supabase-js` from api-server; `wanRenderer.ts` raw-upload cleanup now uses an S3 presigned DELETE. `build.mjs` now bundles `@opentelemetry/*` (better-auth telemetry dep).
- **Verified locally (fresh Postgres 16 + test creds):** typecheck 0 errors; esbuild clean; smoke test `signUpEmail`/`signInEmail`/`signOut` all succeeded and wrote correct `user` (+`account` with password hash, `provider_id=credential`) and `session` rows.
- **NOT done (Phase 3B remaining):** frontend migration off `@supabase/supabase-js` (auth-context, authFetch, sign-in/sign-up pages), Resend email wiring, Google OAuth end-to-end, rate limiting on auth endpoints, and full cross-user authorization tests.

---

## Stage A - Lightsail PostgreSQL preflight (2026-10-17, read-only inspection)

- **Instance:** `growthforge-box-8gb` @ `15.222.206.60`. 2 vCPU, **7.6 GiB RAM** (6.3 GiB available), **2 GiB swap** (0 used), **154 GB disk** (146 GB free).
- **Postgres:** server **not installed** (only `postgresql-client-16`/`-17` + `libpq5`). No clusters (`pg_lsclusters` absent), no systemd unit, **nothing on 5432**.
- **Firewall:** UFW active; allows OpenSSH/80/443 only - **5432 not exposed** (correct; keep local-only).
- **Other local DB use:** none (no reachable local database).
- **Running on box:** two Node API processes (dev ~420 MB, prod ~419 MB RSS), Caddy. Plenty of headroom for Postgres.
- **Plan (awaiting approval):** `sudo apt install postgresql-16`; create role `growthforge_app` (scram-sha-256) + DB `growthforge`; `pg_hba.conf` localhost=scram-sha-256, remote=reject; run `drizzle-kit migrate` against dev env only. **Cost: $0/month incremental** (runs on existing box).
- **Rollback:** `apt` install is additive; before install take a snapshot of the box + `pg_dumpall` is N/A (no existing DB). `apt remove` restores prior state.

---

## Stage B - PostgreSQL 16 INSTALLED on Lightsail (2026-10-17, EXECUTED)

- **Package:** `postgresql-16=16.15-0ubuntu0.24.04.1` (Ubuntu noble-updates, explicitly pinned - NOT PGDG). Verified installed + running cluster `16/main` on `127.0.0.1:5432`.
- **Recovery checkpoint:** Lightsail snapshot was **not possible** - the instance role `AmazonLightsailInstanceRole` is denied `lightsail:GetInstances`/snapshot actions. Equivalent rollback established instead: no prior PG data existed, `dpkg --get-selections` baseline captured (`/tmp/dpkg-baseline-before-pg.txt`), rollback = `apt-get remove --purge postgresql-16`.
- **Role/DB (credentials redacted):** role `growthforge_app_dev` (LOGIN, not superuser), DB `growthforge_dev`, scram-sha-256. `DATABASE_URL` stored at `/etc/growthforge-dev-db.env` (chmod 600).
- **Access:** `listen_addresses=localhost` (default), `pg_hba.conf` = local `peer` + `127.0.0.1/32`/`::1/128` `scram-sha-256`, no remote rules. UFW has no 5432 rule → not exposed.
- **Migrations:** `drizzle-kit migrate` via SSH tunnel → **57 tables, 43 FKs, 2 journal rows** (`0000_baseline` + `0001_better_auth`) applied and verified.

---

## Stage B - Identity mapping (user ↔ users) - DONE + verified

- **Fix:** `databaseHooks.user.create.after` in `betterAuth.ts` auto-creates the application `users` row with `id = user.id` on every Better Auth user create (email/password + Google). No dependence on the frontend calling `/auth/provision`.
- **Verified:** smoke test sign-up wrote both `user` and `users` rows with identical ids (`users.id === user.id`). `/auth/provision` remains idempotent (updates email/canAccessDev if the row exists).

---

## Stage B - Better Auth frontend + security (2026-10-17)

- **Frontend:** replaced Supabase JS with `better-auth` React client (`lib/authClient.ts`). Rewrote `auth-context` (keeps Clerk-shaped `useAuth()` contract → 9 consumers unchanged). Migrated `sign-in`/`sign-up` (`signIn.email`/`signUp.email`/`signIn.social` Google) and simplified `auth-redirect` (no client-side OAuth code exchange). Removed `authFetch.ts` + `supabaseClient.ts` + `@supabase/supabase-js`. Typecheck clean; Vite build succeeds.
- **Security:** Better Auth rate limiting enabled (60 req/60s per IP + tighter built-in special rules for sign-in/sign-up/reset). Verification/reset emails wired to Resend (`notifications@usegrowthforge.com`) with a warning-log fallback; token URLs never logged.
- **NOT yet tested end-to-end:** full browser flow (register→sign in→onboard→project→media), Google OAuth (needs `GOOGLE_CLIENT_ID`/`SECRET` + `BETTER_AUTH_URL`), real Resend delivery.

---

## Stage B - Backup & recovery (2026-10-17)

- **Script:** `scripts/backup-postgres.sh` (in repo) deployed to `/usr/local/bin/growthforge-backup.sh`. `pg_dump -Fc` → `gpg --symmetric --cipher-algo AES256` (passphrase in `/etc/growthforge-backup.env`, chmod 600) → local `/var/backups/growthforge` (30-day retention) → optional Wasabi upload.
- **Cron:** nightly 03:00 UTC, logs to `/var/log/growthforge-backup.log`.
- **Restore test:** decrypted a real dump and `pg_restore --clean --if-exists` into `growthforge_restore_test` → **57 tables, 2 journal rows** recovered, then dropped the throwaway DB. PASSED.
- **REMAINING:** off-server upload is **not yet enabled** - it requires a SEPARATE Wasabi credential (`BACKUP_S3_*`) distinct from the media-storage `OBJECT_STORAGE_*` creds. The script already skips upload safely when those vars are absent.

---

## Stage B - Commit history (this session)

- `359ab33` Better Auth backend (schema, migration, instance, middleware, routes, Supabase removal)
- `57e2d5a` register: Phase 3B backend + preflight
- `1aadddd` auto-provision users row (identity mapping)
- `8f4cd89` frontend migration off Supabase → Better Auth client
- `5d19b78` rate limiting + Resend email wiring
- (backup script commit) `scripts/backup-postgres.sh`

**Incremental cost: $0.00** (Postgres on the existing box; no new AWS/Wasabi resources).

---

## Stage B - DEVELOPMENT CUTOVER (2026-10-17, EXECUTED)

- **Deployed commit:** `6c62b82` (includes `ab9819d` + the `/api/auth` route-order fix). Backend `dist/index.mjs` + frontend `dist/public` built from this commit and pushed to `/home/ubuntu/dev/app/`.
- **Rollback backup:** `/home/ubuntu/dev/app/.cutover-backup-20261017-090926` (old backend dist 18 MB + frontend public 3.2 MB + `.env`). Rollback = restore these files + `systemctl restart growthforge-dev-api`.
- **Env changes (dev only):** `DATABASE_URL`/`DIRECT_DATABASE_URL` → `postgresql://growthforge_app_dev@127.0.0.1:5432/growthforge_dev`; `BETTER_AUTH_SECRET` (generated, 64 hex) + `BETTER_AUTH_URL=https://dev.usegrowthforge.com` added. `OBJECT_STORAGE_*` (Wasabi), Stripe, Google AI vars preserved. `growthforge-prod-api` + Caddy NOT restarted; prod env NOT touched.
- **Bug found + fixed during cutover:** the Better Auth `/api/auth/*` handler was mounted before the app router, swallowing `/api/auth/provision`, `/api/auth/me`, `/api/auth/start-trial`. Reordered (app routes win, rest fall through to Better Auth). Fixed in `6c62b82`.

### E2E test results (against dev.usegrowthforge.com)

- ✅ Register (email/password) → HTTP 200, session cookie `__Secure-better-auth.session_token`.
- ✅ Identity mapping: `user.id === users.id` (verified in `growthforge_dev`).
- ✅ Login (email/password) → HTTP 200.
- ✅ Session persistence across backend restart.
- ✅ `GET /api/auth/me` → correct `users` row (after route fix).
- ✅ `POST /api/auth/provision` → 200.
- ✅ Create project (`POST /api/projects`) → 201, saved to PostgreSQL; list returns it.
- ✅ Business / creator / hybrid onboarding (`POST /api/onboarding`) → projects created, `users.onboarding_complete = true`.
- ✅ Cross-user access denial: user B `GET /api/projects/1` (user A's) → 404 "Project not found".
- ✅ Logout → `{"success":true}`; `get-session` → null afterward.
- ⚠️ Wasabi presigned upload URL generated correctly (`s3.ca-central-1.wasabisys.com`); byte-level PUT/GET not completed via curl (S3 CRC32 checksum header in the presigned URL - the app's real upload uses the SDK `save()` path).
- ⏸ Google OAuth: not tested (no `GOOGLE_CLIENT_ID`/`SECRET`).
- ⏸ Resend email delivery: not verified (sender not yet confirmed).
- ⚠️ Stripe: `stripe-replit-sync` logs "relation stripe.accounts does not exist" (non-fatal) - the `stripe` schema is in the old Supabase DB, not yet migrated to local Postgres.

### Backup status

**LOCAL ENCRYPTED BACKUP VERIFIED - OFF-SERVER DISASTER RECOVERY PENDING.** Nightly cron active (03:00 UTC); a real decrypt→`pg_restore` drill recovered 57 tables. Off-server Wasabi upload is NOT yet enabled (separate `BACKUP_S3_*` credential still needed).

**Incremental cost: $0.00.**

---

## Stage C - Social-only analysis fix + dev restart + E2E verification (2026-10-17)

- **Commit:** `a573793` — `/analyze` now falls back to `business_sources.declared_content`
  (then `projects.description`) for non-website sources; `analysis-progress` passes
  sourceType/sourceUrl/description and uses source-agnostic copy; handle-only social users
  get the inline description form on insufficient grounding.
- **Dev restart:** `growthforge-dev-api` restarted 19:52 UTC (owner-approved). Staged dist
  checksum matched `a573793` build exactly. Rollback artifact (`dist.rollback-f0da3c4/`),
  timestamped backup (`dist.bak-a573793-*`), and `ROLLBACK.txt` manifest created on server.
  `growthforge-prod-api` + Caddy NOT touched.
- **Post-restart:** `/api/healthz` 200 `{"status":"ok"}`; `/api/auth/me` 401 (route live);
  no error-level journal entries since start.
- **E2E social-only test (no website):** disposable account `gftest-socialonly@example.com`
  (trial) → onboarding as **Business** → source **Instagram** (`instagram.com/adanma.styles`)
  + declared description → no website → analysis → competitors → personas → strategy all
  completed. Project `5` "Adanma Styles" persisted to PostgreSQL.
- **Verified in DB:** `business_sources` row (source_type=instagram, retrieval_method=none,
  declared_content saved, retrieved_content null — no fabricated retrieval); analysis
  status=complete (industry "Women's Fashion & Custom Tailoring"); 4 real Nigerian/African
  competitors (Tubert, Kiki Kamanu, Rikaoto by ME, Grass-Fields); 3 Nigerian personas
  (incl. "Owambe Guest"); marketing_strategy status=complete.
- **Result:** social-only Nigerian business journey verified end-to-end. Actual social
  profile retrieval still NOT implemented (manual declared content only) — tracked in
  Phase 4. Multi-source analysis NOT yet wired (Phase 3).
- **Incremental cost:** $0.00.

---

## Stage D - Phase 4 (Meta retrieval) + Phase 3 (multi-source) (2026-10-17)

- **Commit:** `b2def11` — read-only Meta Graph retrieval service + multi-source `/analyze`.
- **Retrieval:** `metaProfileRetrieval.ts` reads authorized FB Page (name/category/about/
  description/website/fan_count + recent post messages) and IG business/creator
  (username/name/bio/media_count/followers_count/website + recent media captions) via
  `pages_read_engagement` + `instagram_basic` (Graph v20.0). Persists into `business_sources`
  with `retrievalMethod=meta_graph_api`, `authorizationStatus=authorized`. Never fabricates.
- **Multi-source:** `/analyze` now gathers primary + Meta-retrieved + other declared ledger
  sources, dedupes, caps grounding at 30k chars, writes one `analysis_source` snapshot per
  source. `POST /projects/:id/sources/retrieve` added for independent verification.
- **Testing:** typecheck ✅ (0 errors) · build ✅ · 157 unit tests pass (1 pre-existing
  DB-blocked file). New: 3 meta-formatting + 3 multi-source helper tests.
- **BLOCKER — live retrieval not yet verified:** `meta_connections` is EMPTY in dev (0
  connected FB/IG accounts). Retrieval service is implemented + unit-tested against mock
  payloads, but actual Graph API access can only be proven once a real Facebook Page +
  Instagram business account is connected via the OAuth flow. `instagram_basic` in code is
  NOT treated as proof of usable permission (per owner guidance).
- **Deployment:** NOT deployed (needs new dev API restart approval). No schema migration.
- **Incremental cost:** $0.00.
