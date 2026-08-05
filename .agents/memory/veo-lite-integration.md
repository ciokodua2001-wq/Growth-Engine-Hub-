---
name: Google Veo 3.1 Lite integration (chosen video provider)
description: Why Veo 3.1 Lite was chosen over Kling/Wan/Fast, and the technical contract used to wire it into sceneManager.ts as a third selectable video render provider
---

## Why

A client production brief (Sharp Insurance "MySharp App" 30 s commercial, 4
talking-actor shots) was rendered side-by-side with Veo 3.1 Fast (1080p,
$0.12/s) and Veo 3.1 Lite (1080p, $0.08/s) to compare against the existing
Kling v2.6 pipeline ($0.15/s). The user picked **Veo 3.1 Lite** as the
production winner — the best price/quality balance for to-camera talking-actor
commercial footage with native dialogue + ambient audio.

Wan 2.2/Vast.ai is kept as dormant standby infra (its cold-start/worker-churn
issue was never fully resolved — see `wan-vast-video-migration.md`). Kling's
code remains fully intact as the manual, explicit fallback. **There is no
automatic per-scene fallback between any of the three providers** — an outage
on the active one fails visibly (`status="failed"`, `errorMessage` set) rather
than silently switching, per explicit user direction established during the
Wan migration.

`ACTIVE_VIDEO_PROVIDER` now accepts `"veo" | "wan" | "kling"` (see
`videoProviderConfig.ts` and `sceneManager.ts`'s `processScene` dispatcher).

## HTTP contract (Gemini Developer API, verified against a working standalone test harness)

Proven live by generating and downloading 8 real 7–8 s clips
(`C:\Users\User\Downloads\veo-comparison\generate.mjs` + `shots.mjs`) before
this integration landed — the contract below is copied from that working code,
not re-derived from docs alone.

1. `POST {BASE_URL}/models/{model}:predictLongRunning`
   - `BASE_URL = https://generativelanguage.googleapis.com/v1beta`
   - `model = veo-3.1-lite-generate-preview`
   - Auth: `x-goog-api-key` header — reuses the existing `GOOGLE_GENAI_API_KEY`
     (same key already used for Gemini text/image), no new secret.
   - Body: `{ instances: [{ prompt, image?: { bytesBase64Encoded, mimeType } }],
     parameters: { aspectRatio, durationSeconds, resolution } }`.
   - Response: `{ name: "<operation name>" }` — a long-running operation.
   - **Lite does NOT accept `negativePrompt`** — sending it causes a 400. Fast
     and the full model do accept it.
   - 429s happen under concurrent submission bursts — retry with backoff
     (`15_000 * attempt`ms) and stagger submissions ~4 s apart.
2. `GET {BASE_URL}/{operationName}` — poll every ~10 s until `done: true`.
3. `response.generateVideoResponse.generatedSamples[0].video.uri` (or
   `generatedSamples` directly, depending on model) holds the downloadable
   clip. Download with the same `x-goog-api-key` header (not a query param —
   keeps the key out of logs/URLs).

## Capabilities that shaped the integration

- **Aspect ratio: 16:9 or 9:16 ONLY — no native 1:1/square.** For a
  square-format request, `veoRenderer.ts` renders 9:16 instead of 16:9: the
  assembler's scale+pad step then pillarboxes left/right (not top/bottom),
  which keeps a to-camera talking actor's full height in frame — better than
  cropping a wide shot's height down to a square.
- **Duration: 4, 6, or 8 s only** (not Kling's 5 s). We fixed Veo scenes at
  8 s (`VEO_SCENE_DURATION_SEC`) — long enough for a full spoken line. This
  means Veo needs a *different* scene count than Kling/Wan to hit the same
  target duration; `computeTargetSceneCount()` in `sceneManager.ts` now takes
  a `clipLenSec` parameter and picks 2/4/6/8 scenes (not 3/6/9/12) when Veo is
  active. The active provider is folded into the prompt fingerprint hash too,
  so switching providers always forces a fresh scene-count recomputation
  instead of reusing a stale cached decomposition.
- **Image-to-video IS supported** (`image: { bytesBase64Encoded, mimeType }`
  in the instance) — used for the same T2V (new scene cut) / I2V (continuity,
  fed the previous scene's last frame) pattern Wan already established.
- **Native audio confirmed supported on Lite** (`Output: Video with audio` per
  the model's own docs page) — video and audio (dialogue + ambience) arrive
  already muxed into one MP4, same as Kling v2.6 native audio. No separate
  TTS/mixing step.
- Resolution: Lite supports `720p`/`1080p` only (no 4K) — matches the
  platform's existing 1080p default.

## Storage

Reuses the exact same `objectStorageClient`/`signObjectURL` helpers as
Wan/Kling — `renders/veo/video-{id}-scene-{index}.mp4` +
`...-lastframe.png`, signed URLs (4h for the clip, 24h for the last frame).
Last-frame extraction reuses `wanFfmpeg.ts`'s `extractLastFramePng()` directly
(it's generic ffmpeg, not actually Wan-specific despite the filename).

## What's still manual

Flipping the live `.env`'s `ACTIVE_VIDEO_PROVIDER` to `veo` was deliberately
left for the user to do explicitly once they're ready to spend real API
credits — this integration only adds the *capability*, it doesn't flip the
production switch on its own.
