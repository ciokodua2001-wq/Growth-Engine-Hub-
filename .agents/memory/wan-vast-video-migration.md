---
name: Wan 2.7 self-hosted video worker migration (Vast.ai)
description: Plan and progress for replacing Kling AI 2.5 video generation with a self-hosted Wan 2.7 14B worker on rented Vast.ai GPU hardware
---

## Why
Kling AI 2.5 API costs were too high at scale. Replacing with a self-hosted, open-source
Wan 2.7 (14B) model running on on-demand GPU hardware (Vast.ai), with `min_workers=0` /
`scale_down_delay=300s` so idle time costs ~$0. Kling stays wired in as an automatic
fallback via a feature flag, not deleted.

## Key facts
- Wan 2.6 is a proprietary hosted API, NOT self-hostable — Wan 2.7 (14B) is the correct
  open-source/self-hostable equivalent (supports both T2V and I2V).
- Target GPU: 1x NVIDIA A100 PCIE (80GB VRAM) on Vast.ai.
- Output: 720p/1080p, native audio.
- Scene-cut logic: new scene → T2V; continuity within a scene → I2V using the last frame
  of the previous clip (extract via ffmpeg).
- Async queue + webhook callback pattern (same shape as the existing Kling polling flow,
  but push-based instead of poll-based where possible).

## Env vars (added to .env / .env.example / scripts/deploy/{dev,prod}.env.example)
- `ACTIVE_VIDEO_PROVIDER` = `wan` (default) or `kling` (legacy fallback)
- `VAST_AI_API_KEY` — Vast.ai account API key (Keys → API Keys → +New in the Vast.ai
  console; the key is shown ONCE at creation with a copy-icon next to the masked value —
  if you navigate away before copying, the key is gone forever and must be deleted +
  regenerated, there's no "reveal again" option)
- `VAST_AI_ENDPOINT_ID` — filled in once the serverless endpoint is provisioned (pending)
- `KLING_API_KEY` — kept for the fallback path

## Architecture plan
1. DB migration: add `newSceneCut`, `provider`, `sourceFrameUrl` columns to
   `kling_scene_jobs` (or a renamed/new `video_scene_jobs` table).
2. `VideoProvider` abstraction in `artifacts/api-server/src/lib/` — common interface
   already sketched by `commercialRenderer.ts`; `KlingCommercialRenderer` becomes one
   implementation, add a `WanCommercialRenderer` implementation.
3. `WanRenderer`: calls the Vast.ai serverless endpoint's PyWorker HTTP route with a
   T2V or I2V request payload; async job id returned, webhook/poll for completion.
4. ffmpeg helper to extract the last frame of a scene's rendered clip, for I2V
   continuity input on the next scene.
5. Wire `ACTIVE_VIDEO_PROVIDER` switch + try/catch → Kling fallback into
   `sceneManager.ts` (the current orchestration point for Kling scene jobs).
6. Docker container: ComfyUI (or vLLM) + Wan 2.7 14B weights + a small PyWorker HTTP
   shim implementing Vast.ai's serverless contract.
7. Provision the Vast.ai serverless endpoint: `min_workers=0`, `cold_workers=0`,
   `min_load=0`, `inactivity_timeout=300` (5 min scale-to-zero).
8. Rent real GPU time, run an end-to-end T2V + I2V test.
9. Update docs (`docs/deployment.md` or similar) with the new provider + fallback
   behavior.
10. Deploy updated `api-server` to dev, verify, then prod.

## Status (as of 2026-08-04)
- `VAST_AI_API_KEY` obtained and stored in root `.env` (local) — not yet on the
  Lightsail server's dev/prod `.env` files, and not yet in the deploy env examples'
  actual values (placeholders only, by design — real secrets never committed).
- **DB migration done.** `kling_scene_jobs` (`lib/db/src/schema/klingSceneJobs.ts`)
  now has `provider` (text, not null, default `'kling'`), `new_scene_cut` (boolean,
  not null, default `true`), and `source_frame_url` (text, nullable). Existing rows
  got the defaults automatically (`provider='kling'`, `new_scene_cut=true`,
  `source_frame_url=NULL`), preserving their historical meaning (independently
  T2V-rendered by Kling). New `VideoRenderProvider = "wan" | "kling"` type exported
  from the same schema file for use by the provider abstraction.
  - Applied via `drizzle-kit push` (table already existed live) — run from
    `lib/db` with `DATABASE_URL` temporarily overridden to the value of
    `DIRECT_DATABASE_URL` (drizzle-kit needs a direct connection, not the
    pgbouncer transaction-mode pooler on port 6543).
  - Verified live via a throwaway `pg` query against `information_schema.columns`.
- **Provider abstraction + feature flag wired end-to-end.** New files:
  - `artifacts/api-server/src/lib/videoProviderConfig.ts` — `getActiveVideoProvider()`
    reads `ACTIVE_VIDEO_PROVIDER`, defaults to `"kling"` for any env that hasn't
    explicitly opted in (safe for the Lightsail server, which doesn't have this
    var set yet).
  - `artifacts/api-server/src/lib/wanRenderer.ts` — `WanRenderer` class +
    `checkWanRequirements()`. `renderScene()` is intentionally a stub that
    throws (scaffolding only) — real Vast.ai PyWorker calls are the next task
    (`wan_client`).
  - `sceneManager.ts` `processScene()` is now a dispatcher: if
    `ACTIVE_VIDEO_PROVIDER=wan`, it calls `processSceneViaWan()` (sets
    `provider='wan'` first) as the **exclusive** renderer for new scenes.
    Otherwise it calls `processSceneViaKling()` — the original, unmodified,
    battle-tested Kling submit/poll/retry/store logic, just renamed and
    taking `scene` instead of reloading by id.
  - **IMPORTANT — corrected design (2026-08-04, per explicit user correction):**
    there is NO automatic per-scene fallback from Wan to Kling. If
    `processSceneViaWan()` throws, it's caught internally and the scene is
    marked `status="failed"` with the error message — exactly like a genuine
    Kling failure — NOT silently retried via Kling. The user's stated intent:
    "The goal is to solely generate video through the Wan/Vast.ai setup" —
    Kling's code stays fully intact and untouched as a dormant path, but
    switching back to it during an extended Wan outage must be a deliberate,
    manual operator decision (flip `ACTIVE_VIDEO_PROVIDER=kling`), never an
    automatic silent per-request switch that would mask a Wan outage and
    quietly rack up Kling costs. (An earlier version of this code DID
    auto-fallback per-scene — that was wrong and has been removed.)
  - `checkSceneManagerRequirements()` updated: ready if EITHER
    `KLING_API_KEY` OR (`VAST_AI_API_KEY` + `VAST_AI_ENDPOINT_ID`) is present
    (not both required) — so the render route isn't falsely blocked.
  - `routes/scenes.ts` `formatScene()` now also returns `provider`,
    `newSceneCut`, `sourceFrameUrl` per scene.
  - Note: `lib/db` uses TS project references (`composite: true`) — after
    editing `lib/db/src/schema/*.ts`, run `npx tsc -b --force` inside `lib/db`
    before typechecking consumers like `api-server`, otherwise `tsc -p` in the
    consumer reads stale cached `.d.ts` output and reports false "does not
    exist" errors for newly-added exports/columns.
  - `KlingCommercialRenderer`/`commercialRenderer.ts`/`klingRenderer.ts` are
    DEAD CODE (not imported by any route) — confirmed via repo-wide grep.
    `sceneManager.ts` (used by `routes/scenes.ts` + `renderMonitor.ts`) is the
    real, live rendering path and the one this migration modifies. Don't waste
    time updating the unused `commercialRenderer.ts` interface for this work.
- Still pending: real `WanRenderer.renderScene()` implementation (Vast.ai
  PyWorker HTTP contract, T2V/I2V requests), ffmpeg last-frame extraction
  helper for I2V continuity, worker container build, endpoint provisioning,
  e2e GPU test, docs, deploy.
