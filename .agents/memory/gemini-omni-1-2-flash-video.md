---
name: Gemini Omni 1.2 Flash video rendering
description: gemini-omni-1.2-flash Interactions contract (native audio, 8s, 16:9/9:16), the `:download` Files-API gotcha, continuity feed-forward, and what was verified live on DEV
---

Provider id `omni`, model `gemini-omni-1.2-flash`, code in
`artifacts/api-server/src/lib/omniRenderer.ts`, dispatched from
`sceneManager.processSceneViaOmni`. Switched on with `ACTIVE_VIDEO_PROVIDER=omni`
(also needs `GOOGLE_GENAI_API_KEY` + `DEFAULT_OBJECT_STORAGE_BUCKET_ID`).
No automatic fallback between omni/veo/kling/wan - same manual-switch rule as
`veo-lite-integration.md`.

## What the model gives us

- Native audio **inside** the MP4 (no TTS pass), like Kling v2.6 / Veo 3.1.
- Clip length is fixed at 8 s (`OMNI_SCENE_DURATION_SEC`), so scene count is
  `ceil(duration / 8)`-ish: 15 s → 2 scenes, 45 s → 6 scenes. Assembly math
  subtracts the crossfades: 6 × 8 − 5 × 0.5 = 45.5 s target.
- Resolutions/ar ratios: 16:9 and 9:16 only. **No square/1:1** - surfaced to the
  client through `GET /api/video-provider-capabilities`
  (`{"supportedAspectRatios":["16:9","9:16"]}`), which the Studio export panel
  reads to prune the format checkboxes. Note that path is `/api/...`, NOT
  `/api/projects/...` - hitting the latter returns "Invalid project id" from the
  `projects/:id` route, which is expected, not a bug.

## API contract (verified live, not from docs)

Create: `POST /v1beta/interactions` with `background: true`, `store: true`, and
`response_format: {type: "video", duration: "8s", resolution: "1080p",
aspect_ratio, delivery: "uri"}`. Poll `GET /v1beta/interactions/{id}` until
`status: completed`; the clip lives in the `model_output` step's
`content[].video`.

**The gotcha that cost a DEV deploy:** the returned video URI is

`https://generativelanguage.googleapis.com/v1beta/files/figwq4tpkvuv:download?alt=media`

`:download` is a custom-method **verb**, not part of the resource name. The
first version captured `[^/?]+` and therefore polled
`GET /files/figwq4tpkvuv:download`, which Google rejects with

`400 INVALID_ARGUMENT - GetFileRequest.name: File name may only contain lowercase
alphanumeric characters or dashes (-) and cannot begin or end with a dash.`

The clip had already been generated (and billed) by then, so every scene went
to `failed`. Parse the name as `/files/([^:?#/]+)(?::[a-zA-Z]+)?(?:[?#]|$)/`,
poll metadata at `GET /files/{name}` (`state: ACTIVE`, plus `downloadUri`), then
fetch bytes with the `x-goog-api-key` header - the verb URL, `downloadUri`, and
`{name}:download?alt=media` all return the same MP4 when the key header is
present. Without the key header the verb URL 403s.

## Continuity (I2V) parity - do not regress this

Omni accepts an image + text input to continue a shot, so a scene with
`new_scene_cut = false` must be fed the previous clip's last frame:
`omniRenderer` writes the clip to a temp file, runs `extractLastFramePng()`
(from `wanFfmpeg.ts`), stores `renders/omni/video-{id}-scene-{n}-lastframe.png`
signed for 24 h, returns it as `lastFrameUrl`, and `sceneManager` writes that
URL into the next scene's `sourceFrameUrl` **only where `new_scene_cut =
false`**. This mirrors the Veo path; without it the image branch of
`submitInteraction()` is dead code. Submissions log `mode: "T2V" | "I2V"` so
coverage is greppable in journald.

Still true (and deliberately unchanged): AI decomposition does not author
scene-cut decisions, so in practice every scene is a new cut for **all**
providers. Turning continuity on is a product decision, not an Omni gap.

## Related parse bug (fixed same day, not Omni-specific)

`aiJson.ts extractJsonBlock()` sliced responses to the outermost `{ ... }`. With
`responseMimeType: application/json` Gemini sometimes answers with a bare
top-level array, and the slice stripped the brackets and concatenated the
elements - `JSON.parse` then failed and scene decomposition returned a customer
facing 500. The helper now returns any candidate that parses whole, and
`callDecomposeAI` accepts both `{"scenes": [...]}` and `[...]`.

## DEV verification (2026-11-12, commit 13a2e7a, project 97 / video 25)

- 15 s: scenes 49-50 → 2 × 8 s, assembly 51 landscape complete 15.5 s,
  measured 15.307 s, 1920×1080 H.264 + AAC 44.1 kHz stereo, 14.9 MB, audio mean
  −18.5 dB / max −0.9 dB.
- 45 s: scenes 51-56 → 6 × 8 s, assembly 53 complete 45.5 s, measured
  45.307 s, 32.7 MB, audio mean −21.2 dB (real Omni audio survived assembly).
- Continuity: scene 51 logged `mode: T2V` and stored a 2,264,984-byte PNG
  (HTTP 200 `image/png`); scene 52 carried `new_scene_cut=false` +
  `source_frame_url=renders/omni/video-25-scene-0-lastframe.png` and logged
  `mode: I2V`; both `succeed`.
- All clips stored under `growthforge-media/renders/omni/...` in our own Wasabi
  bucket, never Google's CDN.

## Environment facts that will bite the next person

- DEV runtime DB is **RDS** (`...rds.amazonaws.com/growthforge_dev`), while the
  box still runs a stale local Postgres with a database of the same name.
  `sudo -u postgres psql -d growthforge_dev` hits the LOCAL copy and changes
  nothing the app sees. Always go through `DATABASE_URL` from
  `/home/ubuntu/dev/app/.env`.
- The DEV app role `growthforge_app_dev` is DML-only by design (owner is
  `dbmasteruser`); DDL needs the break-glass URL kept in
  `/home/ubuntu/dev/app/.env.bak.roles`, or `growthforge_migrator_dev`.
- Better Auth session cookies are `__Secure-` signed, so curl over plain http
  silently drops them; pass `-H "Cookie: __Secure-better-auth.session_token=..."`
  explicitly when driving the API by hand.
