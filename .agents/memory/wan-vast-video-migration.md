---
name: Wan 2.2 self-hosted video worker migration (Vast.ai)
description: Plan and progress for replacing Kling AI video generation with a self-hosted Wan 2.2 (14B) worker on rented Vast.ai GPU hardware
---

## Why
Kling AI costs were too high at scale. Replacing with a self-hosted, open-source
Wan 2.2 (14B) model running on on-demand GPU hardware (Vast.ai), with
`min_workers=0` / `inactivity_timeout=300s` so idle time costs ~$0. Kling's code
stays fully intact and reachable only via a deliberate, manual
`ACTIVE_VIDEO_PROVIDER=kling` flip — never an automatic fallback.

## CORRECTED: Wan 2.7 vs Wan 2.2 (read this before touching anything Wan-related)

**Wan 2.7 is API-only. It has no open weights anywhere, as of this writing.**
This was checked TWICE across this migration, both times conclusively:

1. **First check (before this doc's original version):** researched Hugging
   Face + ComfyUI docs — no `Wan-AI/Wan2.7-*` repo, no ComfyUI workflow support.
2. **Second check (2026-08-04):** the user forwarded a "Technical Redirection"
   message claiming Wan 2.7 open weights exist on ModelScope
   (`Wan-AI/Wan2.7-T2V-14B`, `Wan-AI/Wan2.7-I2V-14B`, Apache 2.0, with native
   audio + image-conditioning). This was verified FALSE by directly fetching:
   - `modelscope.cn/models/Wan-AI/Wan2.7-T2V-14B` → **empty/nonexistent page**
   - Hugging Face hub-wide API search for `Wan2.7` → **zero results**
   - Independent investigative write-ups (not SEO content-farm sites) confirm:
     Alibaba's own Wan2.6/Wan2.7 announcements route users ONLY to the paid
     "Model Studio" / wan.video hosted API, never mention weights or a license,
     and there are unanswered GitHub issues accusing Alibaba of exactly this
     bait-and-switch (promising openness, keeping 2.5/2.6/2.7 closed).
   - The specific claim traced back to an SEO content-farm site pattern
     (`wan27.org`-style domains) publishing confident but fabricated repo
     names/commands to rank for "Wan 2.7 open source" searches.

**Wan 2.2 (14B, T2V-A14B + I2V-A14B) is the real, verified, self-hostable,
Apache 2.0 model family** — confirmed live via the Hugging Face API against
`Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (all 6 required files exist, exact sizes
confirmed) and the official `comfyanonymous/ComfyUI_examples` repo (exact,
working T2V + I2V ComfyUI graphs pulled and mirrored in `wanWorkflows.ts`).

**If anyone (including a future agent session) suggests switching to Wan 2.7,
re-verify independently before acting** — do not trust secondhand blog claims;
check `huggingface.co/api/models?search=Wan2.7` (should return `[]`) and the
actual ModelScope page directly.

## GPU sizing — 24GB, NOT an A100 80GB

- Wan 2.2 A14B's model card lists ~80GB VRAM for **naive/simultaneous** loading
  of both the high-noise and low-noise experts — this is where an earlier,
  incorrect "A100 80GB" assumption came from.
- The actual ComfyUI workflow (used by Vast.ai's own official templates, and by
  `wanWorkflows.ts` in this repo) loads/swaps the two experts **sequentially**
  via `UNETLoader` + `ModelSamplingSD3` + two-stage `KSamplerAdvanced` — this
  only needs **~24GB VRAM** with the fp8_scaled checkpoints.
- **Target hardware on Vast.ai: a 24GB-class GPU** (RTX 4090, RTX 5090, RTX
  A5000, L4-24GB) — meaningfully cheaper to rent than an A100 80GB, which
  directly helps the "avoid another expensive billing cycle" goal.

## Env vars (added to .env / .env.example)
- `ACTIVE_VIDEO_PROVIDER` = `wan` (default) or `kling` (legacy, manual-only)
- `VAST_AI_API_KEY` — Vast.ai account API key (obtained 2026-08-04, stored in
  root `.env` and the local toolbox secrets manager)
- `VAST_AI_ENDPOINT_ID` — the Vast.ai serverless endpoint's **name** (the
  `endpoint` field in `/route/` calls) — filled in once the endpoint is
  provisioned (pending; see Status below)
- `VAST_AI_REQUEST_COST` (optional, default 6000 in code) — the relative
  compute-cost signal Vast's engine uses for routing/wake decisions. Set high
  because Wan 2.2 video generation is far heavier than the SD1.5 benchmark
  (baseline 100) this defaults against.
- `VAST_AI_MAX_WAIT_SEC` (optional, default 600 in code) — how long to poll
  `/route/` for a cold-start worker to wake before giving up.
- `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` — generated via
  Supabase Dashboard → Storage → Settings → S3 Access Keys. Lets the Vast.ai
  worker's PyWorker upload rendered clips **directly** into our own
  `growthforge` bucket via Supabase Storage's S3-compatible endpoint
  (`https://<project_ref>.storage.supabase.co/storage/v1/s3` — confirmed live,
  Supabase Storage is fully S3-compatible) — no extra download/re-upload hop
  for the raw asset transfer.
- `KLING_API_KEY` — kept for the manual fallback path

## Architecture — implemented

1. **DB migration (done earlier):** `provider`, `newSceneCut`, `sourceFrameUrl`
   columns on `kling_scene_jobs` (`lib/db/src/schema/klingSceneJobs.ts`).
2. **Provider dispatch (done earlier):** `sceneManager.ts` `processScene()`
   routes to `processSceneViaWan()` or `processSceneViaKling()` based on
   `ACTIVE_VIDEO_PROVIDER` — no automatic per-scene fallback either direction.
3. **ComfyUI workflow_json graphs (`wanWorkflows.ts`, done 2026-08-04):** exact
   mirrors of the official `comfyanonymous/ComfyUI_examples/wan22/` T2V and I2V
   graphs — `CLIPLoader` → `CLIPTextEncode` ×2 → `VAELoader` → `UNETLoader` ×2
   (high/low noise) → `ModelSamplingSD3` ×2 (shift=8) → `EmptyHunyuanLatentVideo`
   (T2V) or `LoadImage` + `WanImageToVideo` (I2V) → `KSamplerAdvanced` ×2
   (two-stage: high-noise enable/steps 0–10, then low-noise disable/steps
   10–end) → `VAEDecode` → `SaveWEBM` (ComfyUI has no native MP4 muxer node).
   81 frames @ 16fps (5.0625s) — closest 4n+1 frame count to Kling's 5s scenes.
   Dimensions: multiples of 32, ~720p-class long edge (`computeWanDimensions()`).
4. **Vast.ai HTTP client (`wanRenderer.ts`, done 2026-08-04):** implements the
   real, verified serverless contract:
   - `POST https://run.vast.ai/route/` `{endpoint, api_key, cost, request_idx,
     replay_timeout}` → poll (10s interval, up to `VAST_AI_MAX_WAIT_SEC`) until
     a worker `url` is returned (cold-start wake).
   - `POST {workerUrl}/generate/sync` `{auth_data: <full route response>,
     session_id: null, payload: {input: {request_id, workflow_json, s3}}}` —
     this call is SYNCHRONOUS and blocks for the entire generation (20 min
     client timeout). `s3` is our Supabase S3-compatible override, built fresh
     per request from `SUPABASE_S3_*` env vars — no reliance on Vast.ai
     account-level env var configuration.
   - Response `output[]` contains a pre-signed URL to the already-uploaded
     (into OUR bucket) raw WEBM. Downloaded locally, transcoded to MP4 via
     ffmpeg (`wanFfmpeg.ts` — `transcodeWebmToMp4()`, since `SaveWEBM` is
     ComfyUI's only built-in video-save node; no native MP4 muxer exists),
     then re-uploaded to the SAME bucket at the deterministic Kling-parity key
     `renders/wan/video-{id}-scene-{index}.mp4`, matching
     `renders/kling/video-{id}-scene-{index}.mp4`. Raw WEBM upload is deleted
     from the bucket afterward (best-effort, non-fatal).
   - **Note:** Wan clips are silent (no native audio, unlike Kling v2.6) —
     `ffmpegAssembler.ts`'s existing `probeHasAudio()` fallback path (music bed
     or silence) already handles this gracefully; no assembler changes needed.
5. **I2V continuity (`wanFfmpeg.ts` `extractLastFramePng()`, partially wired):**
   after every successful Wan scene render, the last frame is extracted and
   stored (`renders/wan/video-{id}-scene-{index}-lastframe.png`, 24h signed
   URL). `sceneManager.ts` writes that URL forward into the NEXT scene's
   `sourceFrameUrl` column **if** that next scene already has
   `newSceneCut=false`. **Still pending:** nothing currently sets
   `newSceneCut=false` on any scene — the AI decomposition prompt in
   `sceneManager.ts` (`callDecomposeAI`) always defaults every scene to
   `newSceneCut=true` (pure T2V). Teaching the AI when a scene should be a
   continuity cut (and wiring that boolean into the scene-creation insert) is
   a separate, not-yet-started task.
6. **Provisioning script (`infra/vast-ai/wan22-provisioning.sh`, done
   2026-08-04):** downloads all 6 required Wan 2.2 fp8_scaled model files
   (T2V high/low noise, I2V high/low noise, shared text encoder, shared VAE)
   from the verified-live `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` HF repo into
   the right ComfyUI model directories on first boot. Full usage instructions
   are in the script's header comment. ~60GB disk footprint for these 6 files
   alone — provision worker instances with ≥100GB disk.

## Status (as of 2026-08-04)
- `VAST_AI_API_KEY` obtained and stored in root `.env` + toolbox secrets.
- DB migration done (see prior status, unchanged).
- Provider abstraction + feature flag wired end-to-end (see prior status).
- **NEW — real implementation shipped, replacing the scaffolding stub:**
  `wanWorkflows.ts` (graph builders), `wanFfmpeg.ts` (WEBM→MP4 transcode +
  last-frame extraction), `wanRenderer.ts` (full Vast.ai HTTP client). All
  typecheck clean against `api-server`.
- **Still pending before a real GPU test clip:**
  - Generate `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` via
    the Supabase dashboard and fill them into `.env` (blocks any real render —
    without these, `checkWanRequirements()` reports not-ready).
  - Host `infra/vast-ai/wan22-provisioning.sh` at a public raw URL and create
    the actual Vast.ai Serverless endpoint (console UI action — template edit,
    provisioning script URL, `min_workers=0`/`inactivity_timeout=300`, 24GB+
    GPU filter) — this is a real-money action requiring the user's go-ahead.
  - Fill in `VAST_AI_ENDPOINT_ID` once that endpoint exists.
  - Rent GPU time and render the first real T2V + I2V test clip end-to-end.
  - Wire the AI decomposition step's scene-cut decision (`newSceneCut`
    authoring) so I2V continuity actually triggers for some scenes — currently
    every scene is T2V-only.
  - Deploy the updated `api-server` build to the Lightsail dev/prod server.
