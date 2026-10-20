# GrowthForge - Pre-Launch Acceptance Matrix (living)

> Updated after the Veo architecture correction + video-assembly acceptance + social-share labeling (commit 51ecf08). Evidence basis is noted per row: **code** (source inspection), **API** (endpoint exercised), **browser** (frontend driven), **DB** (persisted data), **prod** (production verification).

## 1. Core customer experience (WS1)

| Feature | Status | Evidence | Severity | Beta? |
|---|---|---|---|---|
| Signup / onboarding | Working | resolved earlier (auth flows) | - | ✅ required |
| Project creation | Working | project 13 live | - | ✅ required |
| Source retrieval (website) | **Working** | DB: allbirds 12k chars, `http_fetch` | - | ✅ required |
| Source retrieval (authorized Meta) | **Working** | browser+DB: real Page profile+posts, `meta_graph_api`/`authorized` | - | ✅ required |
| Business analysis | Working | project 13 analysis complete | - | ✅ required |
| Marketing strategy | Working | DB: 3 strategies, PDF export | - | ✅ required |
| Content generation | Working | DB: 3 pieces, real Gemini | - | ✅ required |
| Social posts + images | **Working** | browser: 12 posts w/ captions+hashtags+CTAs+Imagen | - | ✅ required |
| Social sharing (non-publishing) | **Honest** | Labels corrected (`51ecf08`): X = web share *intent* (`x.com/intent/tweet` pre-fills composer); LinkedIn/TikTok/Facebook/Instagram = copy caption + open platform for manual paste. No button claims auto-publish | - | ✅ ready |
| Competitors / personas | **Working** | DB: 24 competitors + 9 personas; browser: project 8 shows 5 competitors (Square One, Apollo, Westland, Surex, BrokerLink) + 3 personas (Fiona/Liam/Ryan) on Analysis & Competitors pages. `competitor_report` (summary synthesis) is a *separate* \"Generate Report\" action, empty only because it has not been triggered — not a generation failure | - | ✅ required |
| Save / edit / export | **Done (browser-verified)** | content + social inline edit → save → refresh → reopen all persist (browser: content title + social caption marker survived reload, `8250eb8` + re-verified) | P1 | ✅ ready |

## 2. Google Veo video generation (WS2) - CORRECTED

**Classification: PASS (code + DB), with one P1 nuance.**

| Sub-feature | Status | Evidence |
|---|---|---|
| Model/API config | ✅ PASS | `veo-3.1-lite-generate-preview`, Gemini Developer API, `GOOGLE_GENAI_API_KEY` set |
| Text-to-video | ✅ PASS | `predictLongRunning` + poll; T2V + I2V (last-frame continuity) |
| Native audio | ✅ PASS | MP4 arrives with muxed dialogue+ambience (no separate TTS) |
| Job/status tracking | ✅ PASS | `kling_scene_jobs` (legacy table name) with `provider=veo`, status |
| Output storage | ✅ PASS | Wasabi `renders/veo/*.mp4`, signed URLs; `OBJECT_STORAGE_*` all set |
| Retries/errors | ✅ PASS | 5 submit attempts (429 backoff), 90×10s poll, visible failure |
| Real output | ✅ PASS | 3 "succeed" Veo scenes in project 8 video |
| **Final assembly → playable URL** | ✅ **PASS** | FFmpeg assembled 4 scenes → 30.5s 1080p MP4 (24.2 MB) uploaded to Wasabi `renders/assembled/video-1-landscape-1792442643206.mp4`; `commercial_assemblies` id=4 `complete`, `videos.render_status=complete` + `video_url` set. Verified: ffprobe h264+aac (both 30.500s, audio mean -19.1 dB / max -1.7 dB), browser `<video>` readyState 4, download endpoint re-signs via `refreshAssemblyUrl` (Wasabi-aware, commit `f1912f4`) |

Kling/Wan are decommissioned; **do not reactivate**. The `KLING_API_KEY` absence is irrelevant.

## 3. Content usability (WS3)

| Capability | Status |
|---|---|
| View generated content | ✅ working |
| Copy captions/handles | ✅ working (social) |
| Save (persist) | ✅ working |
| Reopen (list/detail) | ✅ working |
| Regenerate | ⚠️ re-run "Generate"; no per-item regenerate button |
| **Edit captions/copy** | ✅ implemented - `PATCH /content/:id` + `PATCH /social-posts/:postId` (project-scoped) + inline edit UI on content & social pages |
| Download/export | ⚠️ strategy PDF only; no content/social export |

## 4. Commercial & production readiness (WS4) - to audit

- Stripe test checkout/subscriptions/webhooks — ✅ **audited (test mode)**: `STRIPE_SECRET_KEY` = `sk_test_*`, `STRIPE_WEBHOOK_SECRET` set; `/api/stripe/webhook` raw-body + signature verified; `findOrCreateManagedWebhook` + `syncBackfill` at startup; handlers cover `checkout.session.completed` (payment_status==paid), `customer.subscription.created/updated/deleted`; `requireActiveSubscription` blocks cancelled users (403 read-only). 4 test products live via `/api/stripe/products` (Starter $39, Get-Going $99, Growth $249, Agency $599). ⚠️ No test checkout completed yet (no user has `stripe_customer_id`) — payment loop wired but not end-to-end exercised
- Plan inheritance + project limits
- Better Auth + email flows — ✅ **verified active**: server `betterAuth.ts` (Drizzle adapter → PostgreSQL) + frontend `authClient` (`better-auth/react`). No live Supabase dependency: zero `@supabase/supabase-js` imports, no `SUPABASE_URL` usage, no `@supabase` in any package.json. Legacy `supabaseAuth.ts` is a renamed compat layer that now calls Better Auth. **Fixed** `forgot-password.tsx` `forgetPassword` → `requestPasswordReset` (Better Auth 1.7.10 API), typecheck now clean
- Production media storage — ⚠️ **dev/prod divergence (pre-launch gap)**: DEV ✅ on Wasabi (`OBJECT_STORAGE_*` set, bucket `growthforge-media`, endpoint `s3.ca-central-1.wasabisys.com`). PROD ❌ still on the OLD architecture — `/home/ubuntu/prod/app` is an Aug-4 codebase (no `betterAuth.ts`, old `objectStorage.ts`) with `SUPABASE_*` env vars and no `OBJECT_STORAGE_ENDPOINT/REGION/ACCESS_KEY`. Prod serves \"Coming Soon\" only, so this is not live-breaking, but prod must be re-provisioned from the current code + given its own Wasabi bucket/creds before launch
- Migrations (`superseded_at`) — ✅ **forward-only**: active `lib/db/migrations/` (`0000_baseline.sql`, `0001_better_auth.sql`) has no `.down.sql`; the old destructive `0001_p0_creator_sources` (+`.down.sql`) was archived to `migrations-superseded/`. `superseded_at` soft-delete on competitors/personas/analysis. Dev DB drizzle tracking = 2 applied (matches files). ⚠️ Prod DB uses a different migration track (no `drizzle.__drizzle_migrations`, old stripe-replit-sync) — reconcile during prod re-provisioning
- Deployment reproducibility + backup/rollback — ✅ **operational**: daily encrypted backups (cron 03:00 dev `growthforge-backup.sh`, 03:30 Wasabi offsite, 04:30 prod) with `.dump.gpg` files present Oct 17-19; `/etc/growthforge-backup.env` (600) holds a SEPARATE `BACKUP_S3_*`/GPG credential (never `OBJECT_STORAGE_*`); `deploy/restore-test-prod.sh` restore-readiness drill (download→decrypt→throwaway-DB→counts); `ROLLBACK.txt` rollback history; `/api/healthz` returns `{"status":"ok"}`; dev+prod systemd services active; `renderMonitor.ts` monitors renders
- Security / project isolation - ✅ **IDOR fixed** (`e3e2821`): 11 resource-by-id lookups now scoped by `project_id`; 12 ownership-scoping tests + 7 authenticated HTTP cross-user tests (`09e0397`)

## 5. Integration acceptance (WS5)

- Hybrid website + authorized Meta: **pending** (project 13 ready)
- Meta publishing: **deferred external dependency** (needs `pages_manage_posts`/`instagram_*` Advanced Access)

## 6. Pre-existing test failures (reconciled)

**Re-verified test run (`vitest run` with `.env` sourced): 217/224 pass, 7 fail —**
the 7 failures are exactly the Facebook/Instagram direct-publish path below; the
3 import failures are gone once `.env` is loaded (confirmed test-harness env gap,
not product defects).

Confirmed present on the clean tree at `de0408b` (before the IDOR/edit work); these
are **not** regressions from the recent changes but must be classified before beta.

| # | Suite | Test | Symptom | Customer impact |
|---|---|---|---|---|
| 1 | publishRoute | Facebook publish (encrypted token) | 500 vs 200 | Direct FB publishing errors |
| 2 | publishRoute | Facebook publish (plaintext token) | 500 vs 200 | Direct FB publishing errors |
| 3 | publishRoute | re-encryption failure still publishes | 500 vs 200 | Publish fails hard, no graceful degradation |
| 4 | publishRoute | publishingAt lifecycle | 500 vs 200 | Publish lock lifecycle broken |
| 5 | publishRoute | Instagram publish (encrypted token) | 500 vs 200 | Direct IG publishing errors |
| 6 | publishRoute | Instagram publish (plaintext token) | 500 vs 200 | Direct IG publishing errors |
| 7 | statsRoute | IG publish → stats full flow | 400 vs 200 | IG post stats unavailable after publish |

**Impact:** all 7 sit in the Facebook/Instagram **direct publishing** path
(`/social-posts/:postId/publish` + stats). Native social publishing is a **deferred
external dependency** (needs Meta `pages_manage_posts`/`instagram_*` Advanced
Access), so there is **no immediate customer-facing regression today** - but the 500s
indicate the publish route's token-decryption path may fail once Advanced Access is
granted, and must be fixed before native publishing goes live.

Additionally, 3 suites fail to **import** when run without `.env` loaded
(`statsRoute`, `publishRoute` → `GOOGLE_GENAI_API_KEY`; `stuckPublishRecovery` →
`DATABASE_URL`). These are test-harness env gaps, not product defects, and pass when
`.env` is sourced.

## Grouped fixes

**A. Must fix before controlled beta**
1. ~~Content/social-post edit endpoints + UI~~ ✅ done (`8250eb8`)
2. ~~Competitors/personas verification (WS1)~~ ✅ done — 24 competitors + 9 personas generated and displayed (browser-verified)
3. ~~Video final assembly → playable URL (WS2)~~ ✅ done (`f1912f4` + `51ecf08` verified: playable, audible, downloadable, fresh signed URL)
4. Social publish route token-decryption 500s (see §6) - fix before native Meta publishing

**B. Must fix before paid/public launch**
4. Stripe/webhook + plan limits audit
5. Production media storage + migrations
6. Backup/rollback drill

**C. Safe to defer**
7. Native FB/IG publishing (Meta approval)
8. Meta/Google Ads automation
9. Real AI ad creatives (currently hardcoded templates)
10. Advanced analytics


## 7. Controlled-beta GO/NO-GO checklist

**Verdict: 🟢 GO — controlled beta (development, internal only).**

| Gate | Status | Evidence |
|---|---|---|
| Auth (Better Auth, no Supabase) | ✅ | server + frontend on Better Auth; zero `@supabase` imports; `forgot-password` bug fixed (`427a9f0`) |
| Core journey (analysis→strategy→content→social) | ✅ | projects 8/13 live, browser-verified |
| Competitors + personas | ✅ | 24 competitors + 9 personas, rendered |
| Video (Veo → assembly → playable) | ✅ | 30.5s 1080p MP4 in Wasabi, ffprobe h264+aac synced, browser readyState 4, download re-signs |
| Social share honesty | ✅ | labels corrected (`51ecf08`); no false publish claims |
| Stripe (test mode) | ✅ | 4 products live; webhook + enforcement wired (no test checkout yet) |
| Media storage (dev Wasabi) | ✅ | `growthforge-media` bucket, working upload/sign/download |
| Migrations (forward-only) | ✅ | no `.down.sql`; `superseded_at` soft-delete |
| Backup/restore/rollback | ✅ | daily encrypted backups + Wasabi offsite + restore drill + `/api/healthz` |
| Security (project isolation) | ✅ | IDOR fixed (`e3e2821`), 19 authz tests |
| Test suite | ✅ (no beta blocker) | 217/224 pass; 7 failures confined to deferred FB/IG publish path |

**Not blocking beta (deferred / pre-launch):**
- Native Facebook/Instagram publishing — needs Meta Advanced Access (use "copy & open" fallback).
- Prod Wasabi/Supabase re-provisioning — prod is Coming Soon only; reconcile at launch promotion.
- Competitor-report synthesis not yet triggered (separate action, code wired).
- No per-item regenerate + no content/social export (strategy PDF only).

**Blocks GO beyond beta (require owner approval):** production deployment, live billing, real social publishing, paid video generation, Coming Soon removal.


## 8. Release preparation - controlled-beta (in progress)

### Phase 1 - Backup & restore readiness ✅ DONE

> **Operational note (keep validating as data grows):** the 9s restore proved *mechanics* only -
> the prod DB currently has **0 user rows** (Coming Soon, no signups). Recovery of a *populated*
> customer DB is not yet demonstrated. Re-run the restore drill (and add row-count assertions for
> users/projects/content/social_posts) once real beta customers exist, and keep this in the
> operational checklist until then.
Restore drill (`deploy/restore-test-prod.sh`, hardened `c17cde6`) run on the live
server with the latest prod backup (`_infra-backups/growthforge-prod/...-21-52-13Z.dump.gpg`):
- Restored **only** into isolated `growthforge_prod_restore_test` (never `growthforge_prod`).
- GPG AES256 decrypt → valid PGDMP archive (40,565 B encrypted → 276,534 B decrypted).
- Schema verified: **57 public + 29 stripe tables** restored.
- Representative data verified: all 0 rows (correct - prod has no signups yet).
- **Elapsed recovery: 9 seconds.** Cleanup: throwaway DB dropped, temp dir removed.
- Post-check: `growthforge_prod` unchanged (57 tables), prod API service `active`,
  `usegrowthforge.com` still serves Coming Soon (HTTP 200).

### Phase 2 - Stripe test checkout ✅ DONE (2 bugs found & fixed)

Full TEST-MODE lifecycle verified with card 4242... (no real charge):
- Checkout → payment → webhook → subscription persistence → plan → entitlement: PASS.
- Final user state: plan `growth`, status `active`, `stripe_customer_id` + `stripe_subscription_id` set.
- Webhook events received & signature-verified (`customer.subscription.created`, `checkout.session.completed`, `payment_intent.succeeded`, `invoice.paid`).

**Bug 1 (fixed):** webhook never delivered — `REPLIT_DOMAINS` was unset so `findOrCreateManagedWebhook` never ran, and the `.env` `STRIPE_WEBHOOK_SECRET` was a stale `whsec_` for a deleted endpoint. Fixed by adding `REPLIT_DOMAINS=dev.usegrowthforge.com` and blanking the stale secret (app now uses the managed webhook's auto-generated secret from `stripe._managed_webhooks`).

**Bug 2 (fixed, `2abdb80`):** `syncBackfill()` called with no args is a no-op (object defaults to an array, hits `default`). So `stripe.products` was empty and every subscriber fell back to plan `starter`. Fixed to `syncBackfill({ object: "all" })` — now 4 products + metadata backfill on startup.

**Env change (server-only, not committed):** `.env` gained `REPLIT_DOMAINS=dev.usegrowthforge.com`; `STRIPE_WEBHOOK_SECRET` blanked (backup `.env.bak-stripe-webhook-*` kept).

**Edge case (noted, not blocking):** `customer.subscription.deleted` marks the user `cancelled` without checking for other active subscriptions (worked around in test by re-triggering an update on the surviving subscription).
### Phase 3 - Production promotion plan ✅ ready for review
See `PRODUCTION_PROMOTION_PLAN.md` (draft, NOT executed): authoritative commit, backup/rollback
points, Supabase-era migration, Better Auth + Wasabi + Stripe prod config, forward-only migration
risk, build/deploy/smoke, rollback, Coming Soon preservation, and approval gates.
### Phase 4b - Staging build + Wasabi prep (in progress)

- **Prod schema drift diff ✅** — throwaway copy of `growthforge_prod` vs dev: exactly 2 missing
  columns (`competitors.superseded_at`, `personas.superseded_at`). Reconciliation proven on the
  throwaway (0 drift after 2 ALTERs); prod untouched (57 tables / 0 superseded_at). See
  `deploy/reconcile-prod-schema.sql`.
- **Staging build ✅** — clean clone of `main@389fe73` at `/home/ubuntu/prod/app-new`, full
  `pnpm run build` (API + frontend) succeeded; frontend hash `index-Ber1wL9N.js` matches dev
  (identical source). `betterAuth.ts` present (not Aug-4). systemd still points to old prod app;
  Caddy still Coming Soon — nothing deployed.
- **Production Wasabi ⏳ awaiting console login** — needs the owner's root account to create:
  bucket `growthforge-prod-media` (region ca-central-1) + least-privilege sub-user with only
  `s3:ListBucket` on the bucket and `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on
  `growthforge-prod-media/*`. Existing server creds are bucket-scoped and cannot create buckets.

### Phase 4 - Controlled-beta release checklist ✅ drafted

1. **Verified completed gates** — dev auth (Better Auth, no Supabase), core journey, video, social
   honesty, Wasabi dev, forward-only migrations, backup/restore drill (9s), Stripe test-mode lifecycle
   (payment→webhook→subscription→plan→entitlement).
2. **Remaining blockers** — prod still Supabase-era (not migrated); prod Wasabi bucket/creds absent;
   prod DB on a different migration track (needs dry-run drift diff); prod webhook not registered.
3. **Actions requiring owner approval** — prod DB migration, prod Wasabi bucket + sub-user, prod `.env`
   contents, enabling `/api/*` on the prod host for smoke tests, live Stripe key (launch only), Coming Soon removal.
4. **Expected downtime / risks** — zero public downtime if executed as additive (Coming Soon stays up).
   Primary risk = prod DB schema drift during migration (mitigate with throwaway dry-run + encrypted backup).
5. **Deploy + rollback sequence** — see `PRODUCTION_PROMOTION_PLAN.md` §2 (backup), §3 (replace app),
   §10 (build/deploy/smoke), §11 (rollback).
6. **GO / NO-GO criteria** — GO when: prod DB migration dry-run clean, prod `/api/healthz` ok, smoke test
   passes on prod, Coming Soon still intact. NO-GO if: any drift diff unresolved, Wasabi least-privilege
   unverified, or webhook/Stripe smoke fails.
