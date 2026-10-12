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

## Consolidated release entry — social-first Business/Creator/Hybrid (P0)

- **Commit range:** `0af5ca5` (Stage 2A) → `49736f4` (Stage 4)
- **Migration dependencies:** `0001_p0_creator_sources.sql` (+ `.down.sql`) — NOT applied
- **Rollout sequence:**
  1. Restore Supabase + verify backup (runbook §3–4)
  2. Inspect schema + adopt baseline migration (runbook §5–6)
  3. Apply `0001` + verify (runbook §7)
  4. Deploy backend + health check (runbook §8–9)
  5. Deploy frontend + proxy check (runbook §10)
  6. Env validation + DB integration tests (runbook §11–12)
  7. Production smoke tests 1–16 (runbook §13)
  8. Billing entitlement verification (runbook §14)
- **Smoke tests:** 16-item plan in `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` §13
- **Rollback plan:** code redeploy to last good commit; `0001` down migration; full restore
  from verified backup (runbook §15)
- **Production approval status:** ⛔ NOT AUTHORIZED — awaiting explicit authorization before
  restore / migrate / deploy / restart / billing changes.

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
