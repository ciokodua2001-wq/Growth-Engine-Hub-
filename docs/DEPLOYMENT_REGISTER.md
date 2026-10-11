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
- **Testing:** `typecheck:libs` ✅ · `api-server typecheck` ✅ (0 errors) · unit/integration
  tests ❌ not yet run · build ❌ not yet run
- **Staging:** `NOT STARTED`
- **Production:** `NOT DEPLOYED`
- **Blockers:** Supabase paused → no staging DB to apply/verify migration; schema-dependent
  backend code must not ship before the migration is applied.
- **Rollback:** run `0001_p0_creator_sources.down.sql` (guarded: `SET NOT NULL` fails if
  website-less projects exist - backfill sentinel or keep nullable first).

---

## Stage 2 - Backend null-safety + unified source ingestion + source-aware APIs

- **Status:** `IN DEVELOPMENT`

(Details added as sub-stages complete.)

---

## Nigeria launch dependencies (mandatory before launch)

| Dependency | Owner stage | Status |
|---|---|---|
| `en-NG` localization profile | P1 | NOT STARTED |
| `.ng` ccTLD detection | P1 | NOT STARTED |
| NGN currency formatting | P1 | NOT STARTED |
| `Africa/Lagos` time zone | P1 | NOT STARTED |
| Nigerian market intelligence | P1 | NOT STARTED |
| Creator + hybrid support | P0 | IN DEVELOPMENT |
| Social-first onboarding | P0 | IN DEVELOPMENT |
| Database backup verification | gate | NOT STARTED (BLOCKED - DB paused) |
| Billing entitlement consistency | gate | NOT STARTED |
| Production migration safety | gate | BLOCKED - DB paused (baseline adoption pending) |
| Live end-to-end verification | gate | NOT STARTED |

Meta/YouTube account enrichment: **optional** for initial launch.
