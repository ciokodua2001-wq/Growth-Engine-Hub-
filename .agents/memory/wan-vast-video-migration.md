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
- `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` generated and
  confirmed present in `.env` (Supabase Dashboard → Storage → Settings → S3
  Access Keys).
- DB migration done (see prior status, unchanged).
- Provider abstraction + feature flag wired end-to-end (see prior status).
- Real implementation shipped, replacing the scaffolding stub:
  `wanWorkflows.ts` (graph builders), `wanFfmpeg.ts` (WEBM→MP4 transcode +
  last-frame extraction), `wanRenderer.ts` (full Vast.ai HTTP client). All
  typecheck clean against `api-server`. Committed + pushed to `main`.
- `infra/vast-ai/wan22-provisioning.sh` confirmed publicly fetchable at
  `https://raw.githubusercontent.com/ciokodua2001-wq/Growth-Engine-Hub-/main/infra/vast-ai/wan22-provisioning.sh`.

### First live hardware test (2026-08-04/05) — FAILED, root cause found, all resources torn down

Created a real Vast.ai Serverless endpoint (`wan22-video`, id `32821`) +
workergroup (id `41205`) via the raw REST API (`POST /api/v0/endptjobs` +
`POST /api/v0/workergroups`) referencing the official "ComfyUI (Serverless)"
template (`hash_id fca5654f5074d225a432edfe90bddd90`, image `vastai/comfy`),
with `launch_args` overriding `disk=120` and `PROVISIONING_SCRIPT` to our repo
URL, `max_workers=1`, `cold_workers=0`, `test_workers=1`, `gpu_ram=24`.

**What worked:** `/route/` correctly recruited a real GPU worker (confirmed
RTX 5090 32GB and once an under-spec RTX 5070 Ti 16GB — see bug below),
ComfyUI + the PyWorker API wrapper booted successfully inside the container
(`Uvicorn running on http://127.0.0.1:18288`, `To see the GUI go to:
http://127.0.0.1:18188`) — confirming the template, image, and our
`wanRenderer.ts` `/route/` + `/generate/sync` contract (URLs, payload shape,
auth header) are all correct and match the live API exactly.

**What failed:** the recruited worker was destroyed and replaced with a
**fresh** instance roughly every 2–3 minutes, repeatedly, before our
provisioning script could ever finish downloading the ~85GB of Wan 2.2
weights (each fresh instance starts the download from zero — no caching
between churns). Observed 5 different instance IDs churned through in ~13
minutes. One replacement recruited a 16GB card (below our 24GB requirement)
— `gpu_ram` on `create workergroup` may not be a hard filter, worth
double-checking `search_params` syntax next time (e.g. explicitly embedding
`gpu_ram>=24576` — MB — into the `search_params` string too, not just the
top-level `gpu_ram: 24` field, in case that field is advisory-only).

**Root cause hypothesis:** Vast.ai's serverless engine has some worker
readiness/benchmark timeout budget (looks like ~2–3 min) that a worker must
hit before being marked ready ("standby"); ours can never make it because a
fresh 85GB-from-scratch download per boot takes far longer than that. This
is a **download-on-every-boot vs. serverless readiness-timeout mismatch**,
not a bug in our HTTP client code.

**Cost:** small — roughly 10–13 total instance-minutes across 5 churned
instances at ~$0.35–0.42/hr each (well under $1, consistent with what was
disclosed before starting). **All resources fully torn down** immediately
once the pattern was spotted: destroyed every churned instance individually
(`DELETE /api/v0/instances/{id}/`), then deleted the workergroup (`DELETE
/api/v0/workergroups/41205/`) and the endpoint (`DELETE
/api/v0/endptjobs/32821/`) — confirmed zero instances remain. `.env`'s
`VAST_AI_ENDPOINT_ID` was intentionally left blank (that endpoint no longer
exists).

**Recommended fix before retrying (NOT yet implemented — needs a decision):**
stop downloading weights fresh on every cold boot. Options, in order of
likely least effort:
1. **Vast.ai persistent Volume** — rent a plain on-demand instance once,
   run the provisioning script to completion into a Volume-backed path,
   then point the workergroup's `launch_args`/template at that Volume via
   `volume_info` so every future worker mounts the pre-downloaded weights
   instantly instead of re-fetching them. (Needs to confirm workergroup/
   template creation actually supports `volume_info` — only confirmed so far
   for direct single-instance creation via `PUT /api/v0/asks/{id}/`.)
2. **Custom Docker image** — build our own image `FROM vastai/comfy` with
   the 6 Wan 2.2 model files baked in at build time, push to Docker Hub,
   point the template at that image instead of using `PROVISIONING_SCRIPT`.
   Simpler mentally, but a ~60GB image is slow to build/push and updates
   require a full rebuild.
3. Increase `min_workers`/`cold_workers` to keep at least one **warm**
   worker permanently — defeats the "scale to $0 idle cost" goal the user
   explicitly required, so likely not acceptable as a primary fix.

### Diagnostic session (2026-08-05) — root cause CONFIRMED, first successful render, one NEW finding on GPU tier

Per user approval, rented plain (non-serverless) on-demand instances — no
autoscaler churn risk — and watched boot/provisioning live via SSH (temporary
ed25519 keypair generated locally, attached per-instance via
`POST /api/v0/instances/{id}/ssh/`, detached automatically when each instance
was destroyed).

**Root cause definitively confirmed (not a bug):** on a RTX 3090 host, the
provisioning script's 6 sequential `curl` downloads (~85GB total) took **~39
minutes wall-clock** at 17–50MB/s (network-bandwidth-bound, fluctuating).
Watched `docker ps` / `ps aux` / `nvidia-smi` throughout — the container itself
comes up within ~3–4 minutes (that part is fine), then the onstart
`PROVISIONING_SCRIPT` runs for the remaining ~35 minutes downloading models
into a container Vast.ai's serverless engine already considers "running" and
is timing for its benchmark/readiness check. This categorically cannot fit in
whatever short window (empirically ~2–3 min from the first live test) the
serverless engine allows — confirmed via docs
(`docs.vast.ai/guides/serverless/automated-performance-testing`) that there is
no user-configurable "readiness timeout" parameter; the benchmark is baked
into the PyWorker/template itself.

**NEW finding — GPU generation/tier matters, not just VRAM capacity:** tested
actual T2V generation (exact production `wanWorkflows.ts` graph, 1280×704,
81 frames, 20 steps) on two different 24GB cards:
- **Titan RTX (Turing, 2018, no native FP8 tensor cores):** first step alone
  (incl. one-time model-load/compile) took 11m34s; steady-state pace settled
  at **~694s/iteration** — 10 steps × 2 stages would be several hours per
  5-second clip. Confirmed via `nvidia-smi` (100% util, only ~180-206W draw —
  well under the card's TDP, consistent with FP8 ops falling back to slow
  software emulation on hardware without native FP8 support). **Killed this
  test early — not commercially viable at any price.**
- **RTX 5090 (Blackwell, native FP8 support):** same exact workflow JSON,
  same prompt. Steady-state pace **~56s/iteration**. Full 20-step two-stage
  generation completed in **19m11s** end-to-end (`Prompt executed in
  00:19:11` in the ComfyUI log) for a single 5-second 1280×704 clip. **~13x
  faster than the Titan RTX** on paper-equivalent 24GB VRAM.
- **Conclusion:** "24GB VRAM" alone is an insufficient spec — the workergroup
  `search_params` MUST also constrain to GPU architectures with native FP8
  tensor core support (RTX 4090/5090, L40S, H100/A100 — i.e. Ada Lovelace or
  newer / Hopper or newer). Older Ampere/Turing 24GB cards (RTX 3090, Titan
  RTX, A5000) that happen to satisfy the VRAM filter are NOT viable and must
  be explicitly excluded, e.g. via `search_params` GPU name allow-list rather
  than relying on `gpu_ram` alone.

**First successful real render — pipeline validated end-to-end:** on the RTX
5090 instance, submitted the exact production T2V workflow JSON directly to
ComfyUI's `/prompt` API (bypassing the Vast.ai PyWorker route/generate-sync
layer, which was already contract-verified in the first live test) with zero
`node_errors`. Result: a clean 4.1MB WEBM
(`growthforge-wan-diagnostic_00001_.webm`), transcoded with the exact same
ffmpeg flags as `wanFfmpeg.ts`'s `transcodeWebmToMp4()` to a 1.6MB MP4,
downloaded locally and shown to the user — genuinely cinematic quality,
matching the prompt ("aerial drone shot of a modern glass office tower at
golden hour") with correct camera motion, lighting, and no artifacts. This is
the first real end-to-end confirmation that the ComfyUI graph in
`wanWorkflows.ts` produces commercially usable output on correctly-specified
hardware.

**Cost + cleanup:** three instances total across this session (bad/stuck RTX
3090 host destroyed after 15+ min frozen on a single Docker layer — unrelated
host-level fluke, not our bug; Titan RTX ~35 min; RTX 5090 ~80 min). All under
$1 total. All instances destroyed, confirmed zero remain via
`GET /api/v1/instances/`. Per-instance SSH keys auto-removed with their
instances (confirmed `GET /api/v0/ssh/` on the account returns `[]`).

**Decision needed from user — how to run this in production**, given the
confirmed ~35–40 min unavoidable cold-start for a from-scratch weights
download, and Vast.ai's serverless engine having no tolerance for a boot that
slow:

1. **(Recommended) Self-managed on-demand worker pool** — stop using Vast.ai's
   "Serverless" workergroup/autoscaler product entirely for this endpoint.
   Instead, `api-server` directly manages on-demand instance lifecycle using
   the same plain REST calls already proven in this diagnostic session
   (`POST /api/v0/asks/{id}/` to rent, `DELETE /api/v0/instances/{id}/` to
   destroy): rent one instance on the first queued scene job if none is
   already warm, reuse it for subsequent jobs, and destroy it ourselves after
   an idle timer (needs to be materially longer than 300s given the ~35-40min
   cold start cost — e.g. 20-30 min — to avoid re-paying the cold start
   repeatedly for closely-spaced requests). Pros: full control, no fighting an
   opaque benchmark timeout, reuses code already written and tested today.
   Cons: we own the idle-timer logic (not much — a simple poll/cron already
   fits the existing queue architecture); first request after any idle
   teardown still waits ~35-40 min (masked by the app's existing "still
   filming, trust it" UI — but still worth setting expectations).
2. **Custom Docker image with baked-in weights** — build `FROM vastai/comfy`
   with all 6 model files copied in at build time, push to a registry, point
   a NEW workergroup template at it. Only helps if Vast.ai's serverless
   scheduler reuses the SAME physical host across worker churns (their docs
   suggest it "converges" on preferred hardware over time, but this is
   unconfirmed for our case) — Docker's local layer cache on that host would
   then make subsequent pulls fast. The very first pull to any brand-new host
   is just as slow as the raw download (~35-40 min), and Vast.ai does NOT
   support instance-to-template snapshotting (confirmed via docs) — the image
   must be built and pushed externally, a nontrivial one-time engineering
   investment (~90GB image; needs a build environment with fast egress and
   enough disk).
3. Keep serverless but hold ≥1 warm worker permanently (`min_load`/
   `cold_workers` ≥ 1) — guarantees fast starts but abandons the "$0 idle
   cost" requirement entirely; not recommended given that was an explicit
   goal.

### Still pending
  - **Get user's decision on the production worker-management approach**
    (see three options above) — blocks everything else.
  - Implement the chosen approach (most likely: self-managed on-demand pool
    with GPU `search_params` restricted to FP8-native architectures —
    RTX 4090/5090/L40S/H100 — not just `gpu_ram>=24000`).
  - Wire the chosen approach into `wanRenderer.ts` (currently written against
    the Vast.ai Serverless `/route/` + `/generate/sync` contract — needs
    adjustment if switching to self-managed on-demand instances, since those
    expose ComfyUI's native `/prompt` + `/history` API directly instead, as
    used successfully in this diagnostic session).
  - Rent GPU time and render the first real T2V + I2V test clip through the
    actual `api-server` code path (today's render was direct-to-ComfyUI,
    bypassing `wanRenderer.ts`, to isolate variables — still needs a true
    end-to-end test through the real code).
  - Wire the AI decomposition step's scene-cut decision (`newSceneCut`
    authoring) so I2V continuity actually triggers for some scenes — currently
    every scene is T2V-only.
  - Deploy the updated `api-server` build to the Lightsail dev/prod server.
