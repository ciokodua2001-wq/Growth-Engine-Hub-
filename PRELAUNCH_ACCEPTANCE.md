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


---

## Commercial Studio - Script Fidelity, Audio-Accurate Captions & Dialogue Preservation

### Root causes found (Phase A - confirmed with live evidence)

1. **Script/audio drift originates in scene decomposition, not Veo.** `SceneManager.callDecomposeAI()`
   instructed the model to write "a short, punchy marketing line (10-18 words max)" per scene. The
   approved `script`/`cinematicPlan` dialogue was passed as *input*, then **rewritten** into fresh
   `narrationLine`s, and that paraphrase was composed into the Veo prompt (`Narrator voice says: "..."`).
   Veo's native audio then spoke the paraphrase - so the audible words diverged from the approved script.

2. **Captions used the wrong source.** `ffmpegAssembler` built captions from `voiceover ?? script`
   (the whole blueprint text), not from the dialogue actually passed to Veo, and not from the audio.

3. **Caption timing was estimated, not aligned.** `buildScriptSubtitles` distributed caption windows
   proportionally by character count across the total duration ("we don't have real ASR word timestamps").

4. **No actual-audio transcription existed** - nothing compared what was spoken against what was approved.

**Concrete Allbirds evidence (`Step Into Natural Comfort`, video #2):** the stored per-scene
`narration_line` already shows the paraphrase - scene 0 became "Ever feel like your **heavy synthetic**
shoes are holding you back from **real comfort**?" and scenes 1-2 collapsed to "Step into Allbirds soft
eucalyptus fiber shoes for bouncy comfort. **Try Allbirds today.**" (a CTA not in the approved script).

### What was implemented (Phases B-G core)

- **Forward-only migration `0002_script_fidelity.sql`** (idempotent, `IF NOT EXISTS`) adds to `videos`:
  `creative_mode`, `script_status`, `approved_script`, `approved_script_version`, `approved_at`,
  `dialogue_transcript` (jsonb), `transcript_status`, `fidelity_status`, `fidelity_report` (jsonb).
  Applied clean to dev (9 columns verified). Also reconciles the pre-existing `superseded_at` +
  `users.email` unique-index drift into tracked migrations.
- **`lib/dialogue.ts`** - single source of truth for dialogue preservation: `extractDialogueLines`
  (per-shot dialogue from `cinematicPlan`, else sentence-split), `distributeDialogue` (verbatim across
  scenes), `estimateDialogueFit` (deterministic word-count/duration), `compareScriptToTranscript`
  (normalized word diff + material-token flagging), and `transcribeAudioWithGemini` (lazy-imported
  Gemini audio transcription - **existing** key, no new provider).
- **`SceneManager.decomposeBlueprint`** now overrides every scene's `narrationLine` with the approved
  (or draft) script split **verbatim** across scenes - Veo receives the customer's exact words.
- **`ffmpegAssembler`** builds captions from each scene's verbatim `narrationLine`, timed to real scene
  clip boundaries (`buildSceneCaptionEntries` / `buildKaraokeForScenes`) - no more char-count estimation.
- **`routes/script.ts`** - `GET/POST .../script` (approval + versioning), `POST .../transcript`
  (downloads the assembled MP4 → ffmpeg audio → Gemini transcript → fidelity), `GET .../fidelity`.
- **`routes/videos.ts`** - `mode: "my_script"` stores the customer's exact dialogue verbatim (never
  run through AI blueprint generation); editing an approved script resets it to `proposed` (re-approval
  required) and clears stale fidelity.
- **Frontend** - third "My Script" mode with an exact-dialogue input + Save.

### Tests & evidence

- **9/9** new `dialogue.test.ts` unit tests pass (extract/distribute/fit/compare).
- **226/233** full API suite passes; the 7 failures are pre-existing in `statsRoute`/`publishRoute`
  (Meta publishing), untouched by this work.
- **Allbirds actual-audio transcript** (Gemini, assembled 15.48s MP4) vs approved script - captured and
  backfilled to video #2: similarity **0.514**, status **difference**; missing
  `swap/sneakers/tree/get/actually/planet`; added `real/step/into/allbirds/try/today`; CTA "Try Allbirds
  today" spoken but not approved. This is the authoritative "DIALOGUE DIFFERENCE DETECTED" example.

### Honest limitations (not faked)

- **Word-level timestamps**: Gemini audio transcription is phrase-level only. Word-level alignment would
  need a dedicated STT provider - **not introduced without approval**. Captions therefore use per-scene
  timing (real clip boundaries), which is accurate at the scene level but not word-synced.
- **Spoken Nigerian Pidgin**: written Pidgin script support is in the locale layer; *natural spoken*
  Pidgin delivery has **not** been verified (would require fluent-speaker review + paid Veo tests). Not
  marked authentic.
- **Director's Final Cut Review**: implemented as deterministic metadata/fidelity checks, not subjective
  visual scoring (no defensible automated "quality score").
- **Approve + fidelity UI in the production progress panel** and **caption-preview alignment** (browser
  overlay) remain to be wired to the new endpoints; backend is complete.

### Remaining beta blockers (unchanged from Phase 4)

Prod Supabase-era migration, prod Wasabi bucket/creds, prod DB migration track dry-run, prod webhook.


---

## Commercial Studio - Caption architecture: transcript-sourced (commit `29addb2`)

**Verified correction:** captions no longer originate from `narrationLine` or the approved script.
The assembled audio is transcribed (Gemini, existing key), persisted as `dialogue_transcript` with
per-segment timing, and only *reviewed* segments (text + timing) are eligible for caption export.

- `dialogue.ts`: `assignEstimatedTiming` (labeled `estimated`, never word-accurate) + `transcriptToCaptionEntries`
  (only reviewed, timed segments returned - never falls back to script).
- `script.ts`: `POST /transcript` assigns estimated timing and sets `needs_review`; `PUT /transcript`
  stores the customer's corrected text + manual timing → `ready`; `POST /transcript/accept` accepts the
  performance without rewriting the approved-script record.
- `ffmpegAssembler.ts`: caption source = `dialogueTranscript` (reviewed), not scene `narrationLine`.
- `assemble.ts`: captioned export returns **422** unless `transcriptStatus` is `ready`/`accepted` and a
  non-empty transcript exists - never silently substitutes the script.

**End-to-end verification (Allbirds video #2):** reviewed transcript (3 actual-audio segments + manual
timing) persisted with `transcript_status=ready`; scene clips assembled and burned through the real
`ass`→ffmpeg path producing `captioned.mp4` (75.6 MB) + an extracted frame. Caption text confirmed to be
the *transcript* (actual audio), which differs from the *approved* script. Full OCR of the frame wasn't
possible on the box (no tesseract) - the ASS→ffmpeg render path is unchanged from the previously working
caption system, so only the source changed. 12/12 dialogue unit tests pass; api-server typecheck clean.

## Remaining Commercial Studio scope (NOT yet complete - reported honestly)

1. **Frontend customer-workflow UI** (backend endpoints exist): Approve Script + version display,
   Transcribe & Check Fidelity, mismatch review, transcript correction + timing editor, and caption
   preview switched from `voiceover` to the reviewed transcript. Requires adding the new video fields to
   the generated `api-zod`/`api-client` types (currently `dialogueTranscript`, `approvedScript`,
   `scriptStatus`, `fidelityStatus`, etc. are returned by the routes but not declared in the generated
   client types).
2. **Single AI script suggestion** (optional, with explicit acceptance + caching + cost control).
3. **Dialogue-fit warning** surfaced in the UI before paid generation.
4. **Nigerian Pidgin** written-script workflow (do NOT claim spoken-Pidgin support without testing +
   fluent-speaker review).
5. **Director's Final Cut Review** - lightweight, evidence-based (no invented subjective scores, no paid
   AI calls).
6. **Browser acceptance** for Allbirds (all 10 items), then simulated-user onboarding, security-isolation,
   concurrency, and stress testing.

## Production release (still awaiting explicit authorization - untouched)

Prod DB, prod API, Caddy/Coming Soon, live billing all unchanged. Staging build at
`/home/ubuntu/prod/app-new` is from an older commit and must NOT be promoted.


---

## Commercial Studio - DEV completion status (commits `e6b2275` → `1b79a7c`)

**Deployed to DEV (`dev.usegrowthforge.com`) and verified healthy.** Production untouched
(Coming Soon live, prod DB un-migrated, prod API not serving the app, staging build on old commit).

| Commit | Scope |
|---|---|
| `e6b2275` | Script approval/versioning + migration `0002_script_fidelity.sql` (9 columns) + verbatim dialogue to Veo |
| `29addb2` | Captions sourced from reviewed actual-audio transcript (not narrationLine); transcript correction + accept endpoints |
| `fe32a63` | Docs: transcript-sourced caption verification + remaining scope |
| `8bb8fc2` | Customer workflow UI (Approve/Fidelity/transcript-correction) + transcript-sourced caption preview + regenerated client types |
| `99636f9` | Deterministic pre-flight review (dialogue-fit warning + CTA check) |
| `1b79a7c` | Nigerian Pidgin (`pcm`) written workflow (spoken unverified) |

**Verified:** migration 0002 applied to dev DB; dev API `healthz` 200 after each restart; new endpoints
`/script`, `/script/approve`, `/transcript`, `/transcript` (PUT), `/transcript/accept`, `/fidelity` reachable
(401 auth-gated); frontend rebuilt and served; captioned MP4 produced from the reviewed transcript segments
(Allbirds #2) with caption text = actual-audio transcript, not narrationLine.

**Tests:** 231/238 pass; 7 failures are pre-existing in `statsRoute`/`publishRoute` (Meta publishing, untouched).
Dialogue unit tests 12/12; localization (incl. `pcm`) 6/6; typecheck clean across libs/api/frontend.

**Remaining (reported honestly):**
- Optional single AI script suggestion (with caching + cost control) - not yet implemented.
- Full browser acceptance (10-item Allbirds list) - pending; requires DEV host Basic-Auth + app sign-in in the
  shared browser / Windows companion, which need credentials I don't hold.
- Simulated-user onboarding, security-isolation, concurrency, stress, failure/recovery - not yet run.

**Production release:** NOT prepared and NOT executed. Awaiting explicit authorization for the final cutover.


---

## Commercial Studio - browser acceptance (DEV, authenticated as charlieokos2001)

All exercised against the live `dev.usegrowthforge.com` (Project 13 / Allbirds) in the shared browser.

| # | Acceptance item | Result |
|---|---|---|
| 1 | Auto / Prompt / My Script modes | ✅ all three tabs render; My Script input + Save present |
| 2 | Script edit / approval / version | ✅ "Draft - not approved" → click Approve → "Approved v1"; `approved_script` + `script_status=approved` persisted in DB (video #4) |
| 3 | Dialogue-fit + pre-flight warnings | ✅ "28 words ≈ 10.8s vs ~12.8s budget"; "No clear CTA" warning |
| 4 | Actual-audio transcription + mismatch | ✅ assembled video #2 shows DIFFERENCE DETECTED, Similarity 51%, missing/added word list; unassembled videos correctly return "Assemble the video first" (no fabricated transcript) |
| 5 | Transcript review + correction | ✅ segments render with `[0.1-5.2s]` timing; "Correct transcript / timing" + "Accept performance" present |
| 6 | Caption timing + transcript-sourced preview | ✅ code sources preview from `dialogueTranscript`; video player renders assembled MP4 |
| 7 | Original + captioned MP4 downloads | ✅ Share / Copy Link / Download controls present on assembled video; video src = Wasabi assembled MP4 |
| 8 | Captioned-video audio/visual verification | ✅ (backend) `captioned.mp4` produced from transcript segments; caption text = transcript, not narrationLine (verified earlier, commit `29addb2`) |
| 9 | Refresh / reopen persistence | ✅ "Approved v1" persists after reload + re-expand |
| 10 | Cross-project authorization | ✅ other user's project returns 404 "Project not found"; own project 200; no data leak |

**Meta test failures (7) - classified:** all in `publishRoute.test.ts` (6) + `statsRoute.test.ts` (1), all
"expected 200 got 500", in the Meta publish/stats path (`content.ts` + `metaPublisher.ts`). Root cause is
**test-harness** - the tests stub `@workspace/db` + `drizzle-orm` with minimal `_tag`/`vi.fn()` objects that do not
chain with the route's current query patterns (optimistic lock `and(eq,eq,isNull)`, token-encryption migration,
`.returning()`), so the routes throw inside the mocked DB. **Not caused by, and unrelated to, the Commercial Studio
changes** (those files are untouched). Recommendation: refresh the publish/stats route mocks (non-blocking, separate item).

## Remaining (not yet complete)
- Optional single AI script suggestion (caching + cost control).
- Simulated-user onboarding, cross-user isolation, concurrency, stress, failure/recovery.
- Refresh the 7 Meta publish/stats test mocks (test-harness, non-blocking).

Production untouched: Coming Soon live, prod DB un-migrated, prod API not serving, staging on old commit.


---

## Evidence round 2 (AI suggestion, downloads, Meta root cause)

**AI script suggestion (`5555c21`)** - deployed + verified live:
- `POST /script/suggestion` first call: generated (Gemini), `cached:false`; second call same script: `cached:true`, same hash + same text (no repeat AI charge).
- `/accept` replaces `script`, resets `scriptStatus=proposed` + clears approval (re-approval required); `/reject` discards. No silent rewrite.
- migration `0003_smooth_khan.sql` adds `videos.script_suggestion` jsonb (applied to dev).
- 13/13 dialogue unit tests (hashScript determinism added).

**Downloads - actually downloaded and inspected (Allbirds video #2):**
- Plain MP4 (`renders/assembled/video-2-vertical-1792457705840.mp4`): 34,774,862 bytes, 15.5s, h264 1080x1920, aac.
- Captioned MP4 (transcript burn): 70,483,331 bytes, 15.5s, h264 1080x1920, aac.
- Burned caption lines = transcript, not narration:
  1. "Ever feel like your heavy, synthetic shoes are holding you back from real comfort?"
  2. "Step into Allbirds soft eucalyptus fiber shoes for bouncy comfort."
  3. "Try Allbirds today."
- Frame extracted at t=7s (4.79 MB PNG). Both files are valid MP4s (video+audio). Timing uses the reviewed transcript windows (manual alignment, labeled).

**Meta publish/stats (7 failures) - root cause (test-harness, confirmed):**
- Route `content.ts` publish handler performs three `db.select()` reads (post, Meta connection, final re-read) plus the optimistic-lock `update(...).returning()` and token-migration `update`.
- The test mocks (`publishRoute.test.ts`) only configure two `mockDbSelect.mockReturnValueOnce(selectChain(...))` calls, so the route's third `db.select().from().where()` gets `undefined` and throws → 500 (also the `statsRoute` case).
- Fix: add the missing third `selectChain([finalPost])` return (and match the exact query sequence) per test; do not alter production publishing behavior. This is a scoped test-mock refresh, not a product defect. Not yet fixed (deferred - remaining item).

## Remaining
- Refresh the 7 Meta publish/stats test mocks (root cause above) and rerun the full suite.
- Simulated-user onboarding, tenant isolation, concurrency, stress, failure/recovery (with measured latency/errors).

---

## Caption layout / preview / fidelity fixes (release blocker) — evidence

- **Fidelity bounded 0..100%:** `compareScriptToTranscript` now compares UNIQUE word sets (was counting duplicate array words vs deduped union → could exceed 100%, the "104%" bug). 19/19 dialogue tests incl. 6 new regression cases (identical, duplicate-word, partial, extra, empty transcript, empty-vs-empty).
- **Transcript preview:** removed the "Your caption preview" placeholder and the first-line fallback. The browser caption now shows the reviewed `dialogue_transcript` segment at the current playback time (paused/scrubbed/played); no caption outside intervals. `seeked` + initial seed added.
- **9:16 safe-area export:** captions wrap to a pixel-aware max width (8% margin each side) instead of a fixed 40 chars, and the `\pos` anchor is clamped so text cannot spill into letterbox/pillarbox. Verified on the exact line "Swap those heavy synthetics for breathable eucalyptus fiber." → wraps to "Swap those heavy synthetics for breathable" + "eucalyptus fiber." (42 chars, ~830px) within the 907px safe width at 1080x1920.
- **Re-export evidence (no regeneration):** assembly #14 (vertical, clean) re-exported from the existing Allbirds clips → h264 1080x1920, 15.5s; frames extracted at 2s/7s confirm captions render in-frame.
- **Preview/export consistency:** preview now uses video-relative font (`3.5cqw` ≈ export 38px/1080) and `84%` width, matching the export contract; Theater mode gives full-size WYSIWYG.
- **Styles:** all 8 presets (clean, boldPop, karaoke, neonGlow, cinematic, gradientChip, retroVHS, socialBubble) preserved and go through the same safe-area wrap path.

Commits: `c92e1f6` (caption safe-area + preview + fidelity) and the follow-up cqw parity commit.


---

## Caption editor, sync & cost optimization (final caption milestone)

### Root causes
- **Invisible preview:** `onTimeUpdate` nulled the caption whenever `currentTime` was outside a speech interval (e.g. paused at 0:00 before `startSec: 0.1`), so the editor showed nothing. Fixed with explicit **Edit (paused) vs Play** modes.
- **Off-center theater:** the player stage used `width: fit-content` which resolves to 0px inside the flex backdrop, so the video overflowed to one side and the caption overlay anchored to the wrong rect. Fixed by sizing the stage from the video intrinsic `videoWidth/videoHeight` aspect ratio.
- **Preview/export divergence:** preview used a uniform font base; export applies per-preset `sizeMul`. Added the same multipliers to the preview.
- **Cache misses on changed material:** `optionsFingerprint` omitted transcript/timing, renderer version, and source identity. Extended it.

### Browser evidence (DEV, Allbirds Project 13, no new Veo)
- Paused editor shows the real transcript segment ("Ever feel like your heavy, synthetic shoes...") with label "Editing segment 1"; segment selector (1..N) + size/vertical/horizontal sliders + Reset present; drag handle + green resize dot visible and wired (onPointerDown).
- Normal mode: stage 569x320 matches the video rect (567x318); caption box stays inside the frame.
- Theater mode: video horizontally centered (center == viewport center); stage rect == video rect.

### Synchronization evidence
- Scene 0 (Hook) audio: speech 0-2.9s, pause 2.9-3.2s, speech 3.2-8s. Scene 1 (Solution): continuous audio 0-8s (starts at ~7.5s after the 0.5s xfade).
- Transcript timings are `timingSource: "manual"` and do not map 1:1 to the 2-scene structure, which is why captions drift from speech. No renderer bug. Remaining work: expose manual start/end correction controls in the UI (honest alternative to unavailable word-level alignment).

### Cost audit (verified code paths)
- Caption style/size/position/timing changes and "Download with Captions" call only POST /assemble -> FFmpeg + Wasabi. **No Veo/Gemini/transcription/script calls, no credit deduction** in that path.
- Identical exports hit the fingerprint cache (same assembly id returned). Concurrent identical requests reuse the in-flight assembly (same id, no duplicate render/upload).
- Residual costs (not zero): FFmpeg CPU, Wasabi storage (~few MB per render) + egress bandwidth per download.

Commits: `b9a15e0` (editor/centering/parity), assemble cache key + in-flight reuse.



---

## Unclear-speech review + caption editor words (final fix)

### Root causes (this round)
- **Caption words missing in editor:** the caption overlay derived its text from a
  `transcriptSegments` state that was only populated by a `videoRef` metadata
  event, so it could be empty on first paint / theater mode. Fixed by deriving
  segments synchronously from the transcript (with script/voiceover fallback +
  auto-fetch when the list view omits `dialogueTranscript`).
- **Caption editor never rendered for some videos:** `videos.tsx` early-returned
  `CinematicBlueprintViewer` for blueprints with a `cinematicPlan`, skipping
  `CommercialProductionProgress` entirely. Fixed.
- **`[unclear]` was being silently stripped:** an earlier `transcriptToCaptionEntries`
  change removed `[unclear]` markers, which concealed uncertainty. Reverted; the
  marker is now preserved so the UI can flag it, and the export path blocks it.

### Browser evidence (DEV, Allbirds Project 13, Video #5 "Natural Comfort Step", no new Veo)
- Unclear panel: amber "Unclear Actor Speech Detected" banner shows segment 3
  `"And so, please, [unclear] some."` with Replay / 0.75x Slow / 0.5x Slow and a
  Save Correction input pre-filled with the `[unclear]`-stripped text.
- Correction flow: typing "And so, please, try some." + Save Correction PUTs the
  transcript, clears the banner, and updates the caption box to the corrected text.
- Caption editor: normal + theater modes both show the REAL segment words
  ("Stop squeezing your feet into rigid, synthetic shoes.") alongside the drag
  handle and green resize dot. Segment selector shows all 3 segments.
- Export guard: `POST /assemble` with captions on returns 422 "Unclear speech
  must be reviewed first" while `[unclear]` is unresolved (no Veo, no credits).

### Tests
- api-server vitest: 238/245 pass (same 7 pre-existing Meta failures, no new).

Commit: `c41e3d0`.



---

## Caption preview during playback (final fix)

### Root cause
`isVideoPlaying` depended only on the video `play`/`pause` event listeners. When
the timing effect re-runs (re-attaching listeners after a dep change) while the
video is already playing, the `play` event has already fired and is never seen
again - so the editor stayed stuck in "editing" mode and showed the selected
segment instead of the live time-synced caption. Fix: derive playing state from
`v.paused` on every `timeupdate` (fires ~4x/sec during playback).

### Browser evidence (DEV, Video #5 "Natural Comfort Step", editor video, no new Veo)
- Paused at t=0: "Editing segment 1" + selected segment text.
- Play: mode flips to "Following playback"; caption shows the correct segment at
  each timestamp:
  - 0.37-4.27s → "Stop squeezing your feet into rigid, synthetic shoes."
  - 10.8-12.4s → "These Eucalyptus tree fiber sneakers are wildly soft..."
  - 12.8s → empty (brief silence between segments 2 and 3)
  - 13.2-14.8s → "And so, please, [unclear] some."
  - >14.99s → empty (after final segment)
- Pause (mid-playback or end) restores "Editing segment 1" + selected segment.
- Seeking to t=5 while paused shows selected segment; playing from there shows
  segment 2.
- Theater/fullscreen: video centered, same time-synced caption behavior.

Commit: `a0593fc`.

