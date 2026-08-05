---
name: Google AI stack migration
description: Anthropic/OpenAI/ElevenLabs replaced by Gemini + Imagen + Google Cloud TTS across GrowthForge's api-server. Env vars, package layout, provider IDs, and known gotchas.
---

# Google AI stack migration

GrowthForge's api-server was migrated off Anthropic (Claude), OpenAI (GPT/DALL-E),
and ElevenLabs entirely, onto a unified Google stack.

## New packages (replace old ones 1:1)

- `lib/integrations-anthropic-ai` → **deleted**, replaced by `lib/integrations-google-genai`
  - `.` → exports the shared `genai` client (`GoogleGenAI` instance) + batch utils
  - `./image` → `generateImageBuffer(prompt, size)` — Imagen 4 (`imagen-4.0-generate-001`).
    Imagen 3 is **shut down by Google** — do not use it despite older docs/prompts mentioning it.
  - `./batch` — generic `p-limit`/`p-retry` helpers, unchanged logic, just re-homed
- `lib/integrations-openai-ai-server` → **deleted**, replaced by `lib/integrations-google-tts-server`
  - `.` → exports `ttsClient` (`TextToSpeechClient`) + `synthesizeSpeech({ text, voiceName, locale, format })`
  - No `/image` or `/audio` (voiceChat/speechToText) submodules ported — they were dead code
    (never imported anywhere in api-server), so the new lib is TTS-only.

## Credentials (env vars)

- `GOOGLE_GENAI_API_KEY` — simplest path, Gemini Developer API. Works for Gemini text +
  Imagen images. Also works as a fallback for Cloud TTS (its REST surface accepts API-key auth).
- `GOOGLE_CLOUD_PROJECT_ID` + `GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING` — full GCP
  service-account auth (Vertex AI mode for genai, required-ish for Cloud TTS in production).
  The credentials env var holds the **entire service-account key JSON, minified to one line**,
  not a file path — Lightsail/VPS deployments pull everything from `process.env`.
- Old vars fully removed: `AI_INTEGRATIONS_ANTHROPIC_BASE_URL/API_KEY`,
  `AI_INTEGRATIONS_OPENAI_BASE_URL/API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `OPENAI_API_KEY`.

## Model choices

- Text (campaign gen, ad copy, video scripts, tutoring): `gemini-3.6-flash` ($1.50/M in, $7.50/M out)
- Fast/cheap tier (Forge AI chat classify+respond only): `gemini-3.1-flash-lite` ($0.25/M in, $1.50/M out)
  — see `artifacts/api-server/src/lib/aiJson.ts` (`generateJson` vs `generateJsonFast`)
  - **Originally `gemini-2.5-flash`/`gemini-2.5-flash-lite`, changed Aug 2026** — both return a 404
    (`"This model models/gemini-2.5-flash is no longer available to new users..."`) on freshly
    created API keys. `models.list()` still shows them in the catalog and `models.get()` (metadata
    only) still succeeds, but an actual `generateContent()` call 404s — Google gates old model
    generations behind a "new users" grandfathering rule that isn't visible from `models.list()`.
    If a Gemini model call ever starts 404ing with this exact message, re-run `models.list()` /
    a `generateContent` smoke test across candidates to find what the current key can actually use,
    rather than assuming the model name itself is wrong. Confirmed working as of Aug 2026 with this
    key: `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`,
    `gemini-3.1-flash-lite`, `gemini-3.6-flash` — chose `3.6-flash`/`3.1-flash-lite` for best price.
- Images: ~~`imagen-4.0-generate-001` via `ai.models.generateImages()`~~ — **replaced (Aug 2026)**
  with `gemini-3.1-flash-image` via `ai.models.generateContent()` + `responseModalities: ["IMAGE"]`
  + `imageConfig: { aspectRatio, imageSize: "1K" }` (Google's SDK itself deprecation-warns on
  `generateImages()` and points at this path; see "Model gating" section below for why the old
  Imagen models don't work at all on new keys). Response images come back as `inlineData.data`
  (base64) on parts in `response.candidates[0].content.parts` — filter for `p.inlineData?.data` and
  take the **last** matching part (not the first), matching Google's own documented workaround for
  responses that can contain multiple image parts. See `lib/integrations-google-genai/src/image/client.ts`.
- Narration: Google Cloud TTS **Chirp 3: HD** voices, name format `<locale>-Chirp3-HD-<Speaker>`
  (e.g. `en-CA-Chirp3-HD-Charon`, `fr-CA-Chirp3-HD-Charon` — same speaker name works across locales).
  "Journey" voices (mentioned in older specs) are being deprecated by Google — Chirp 3: HD is the
  current equivalent. Default locale is `en-CA`; pass `fr-CA` for French-Canadian narration.

## Structured JSON output

`aiJson.ts`'s `callGemini()` uses `config: { responseMimeType: "application/json" }` on
`generateContent()` instead of markdown-fence scraping. `extractJsonBlock()` is kept as a
defensive fallback for truncated/edge-case output but shouldn't normally be needed.

## platformCredits.ts provider IDs

`Provider` type changed from `"anthropic" | "openai" | ... | "elevenlabs" | ...` to
`"google-genai" | "google-tts" | "minimax" | "kling" | "heygen"`. Both text+image spend
(shared `GoogleGenAI` client) log under `"google-genai"`; narration spend logs under
`"google-tts"`. These are plain DB text columns (no enum constraint), so the rename was safe,
but **the admin dashboard's provider `key` strings must exactly match these DB values** —
see `artifacts/growthforge/src/pages/admin/credits.tsx`'s `providers` array
(uses kebab-case `"google-genai"`/`"google-tts"` even though the JSON response field
names are camelCase `googleGenai`/`googleTts` — those are two different things, don't conflate them).

## No live balance API for Google

Unlike ElevenLabs/OpenAI, Google doesn't expose a simple "remaining balance" REST endpoint —
GCP billing needs the separate Cloud Billing API + its own IAM grant, not worth wiring up.
`admin-credit-status.ts` instead does a cheap non-generating metadata call
(`genai.models.get({ model: "gemini-3.6-flash" })` / `ttsClient.listVoices(...)`) just to
confirm credentials authenticate, and links out to `console.cloud.google.com/billing` for
real spend. Both Google cards are `type: "spend"` (estimated from internal token/char
accounting), not `type: "live"` like the old ElevenLabs/OpenAI cards were.

## Dead code removed during migration (do not re-add without checking call sites first)

- `editImages()` (OpenAI image editing) — never called anywhere
- `voiceChat`/`speechToText`/`speechToTextStream` (OpenAI realtime voice) — never called anywhere
- ElevenLabs↔OpenAI TTS fallback chain — replaced by direct-only Google Cloud TTS (no fallback
  needed; Google doesn't have ElevenLabs' free-plan-blocks-premade-voices problem)

## Post-migration verification (pnpm install / typecheck / build)

- `pnpm-workspace.yaml` needed `allowBuilds: { '@google/genai': false }` (pnpm v11's replacement
  for the deprecated `onlyBuiltDependencies`/`ignoredBuiltDependencies` fields) — otherwise
  `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS` because `@google/genai`'s `prepare` script
  (rollup/api-extractor, only relevant when building from git source) gets blocked by pnpm's
  build-script security policy.
- `ffmpegAssembler.ts` had one leftover `import { prepareScript } from "./elevenLabsNarrator.js"` —
  missed in the initial pass because it only imports the pure-text helper, not the TTS call itself.
  Fixed to import from `./googleNarrator.js` (which re-exports `prepareScript` unchanged).
- Full workspace `tsc --build`, `api-server`'s `pnpm typecheck`, and `pnpm build` (esbuild bundle)
  all pass cleanly after the above two fixes.
- Unrelated pre-existing typecheck failures found in `artifacts/growthforge` (5 files reference
  `Project.detectedLocale`, a column that exists in `lib/db/src/schema/projects.ts` but isn't in
  whatever type the frontend imports as `Project`) — **not caused by this migration**, left
  untouched; flag to fix separately if it matters.

## Lightsail deployment gotchas (hit during the actual server rollout)

- **`@google/genai` / `@google-cloud/text-to-speech` must ALSO be direct dependencies of
  `artifacts/api-server/package.json`**, not just of the internal `lib/integrations-google-*`
  packages. `build.mjs` externalizes `@google/*` and `@google-cloud/*` from the esbuild bundle
  (same reason `google-ads-api`/`google-auth-library`/`protobufjs` are already direct deps there —
  these packages read sibling `.proto`/asset files via relative fs paths at runtime and break if
  bundled). Externalized packages stay as bare `import` specifiers in `dist/index.mjs`, and pnpm's
  isolated `node_modules` only symlinks a package into node_modules for workspaces that *directly*
  declare it — so without this, the built server throws `ERR_MODULE_NOT_FOUND` for `@google/genai`
  at boot even though `pnpm install`/`pnpm build` both succeed with zero errors.
- **Never write `REPLACE_ME` (or similar placeholder text) into `GOOGLE_CLOUD_PROJECT_ID` /
  `GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING` on a live `.env`.** Both client `buildClient()`
  functions originally did `if (projectId && credentialsJson)` — a non-empty placeholder string is
  truthy, so it took the service-account branch and crashed on `JSON.parse("REPLACE_ME")` instead of
  falling through to the `GOOGLE_GENAI_API_KEY` fallback. Fixed by adding an `isConfigured()` guard
  in both `lib/integrations-google-genai/src/client.ts` and
  `lib/integrations-google-tts-server/src/client.ts` that treats blank/placeholder-looking values
  (`REPLACE_ME`, `your-key`, `todo`, `changeme`, `xxx...`) as unset. **Leave these two vars truly
  blank** (`KEY=` with nothing after it) in any env file until real service-account credentials
  exist — don't use placeholder text.
- No git remote/CLI was available locally in this session, so the rollout to both
  `growthforge-dev-api` and `growthforge-prod-api` was done by tarring the changed source
  (`lib/integrations-google-*`, `artifacts/api-server/src`, root/`api-server` `tsconfig.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `artifacts/api-server/package.json`, `.env.example`
  files) and `scp`-ing it directly into `/home/ubuntu/dev/app` and `/home/ubuntu/prod/app`, then
  `rm -rf`-ing `lib/integrations-anthropic-ai`, `lib/integrations-openai-ai-server`, and
  `artifacts/api-server/src/lib/elevenLabsNarrator.ts` (tar overlay doesn't delete files missing
  from the archive), then `pnpm install` + `pnpm --filter @workspace/api-server run build` + a
  systemd restart on each. **If a local dev copy of a workspace `lib/*` package has already been
  built (has `node_modules`/`dist`/`*.tsbuildinfo` inside it), strip those before tarring** — pnpm's
  symlinked `node_modules` don't survive being copied to a different machine/path and will shadow a
  correct install.
- Both `growthforge-dev-api` (port 4001) and `growthforge-prod-api` (port 4002 — check
  `PORT=` in each app's `.env` rather than assuming) came up clean after the above two fixes:
  `/api/healthz` → `{"status":"ok"}`, and a direct `ai.models.get({model:"gemini-2.5-flash"})`
  call with the real `GOOGLE_GENAI_API_KEY` succeeded on both. The pre-existing "Stripe backfill
  failed (non-fatal)" WARN on both boots is unrelated to this migration (Stripe/Supabase schema
  issue) and was already present before these changes.
- **Follow-up (same day):** the first real "Run Business Analysis" call in the UI 404'd with
  `models/gemini-2.5-flash is no longer available to new users` — `models.get()` succeeding above
  only proved the key/model *exists*, not that `generateContent()` (the actual call path) would
  work on it. Switched `MODEL`/`FAST_MODEL` in `aiJson.ts` to `gemini-3.6-flash`/
  `gemini-3.1-flash-lite` (both smoke-tested with real `generateContent()` calls first) and
  redeployed via the same tar+scp+rebuild+restart flow to both dev and prod.
- **Follow-up #2 (same day): "AI SEO War Room" strategy generation failed with "Failed to generate
  SEO strategy. Please try again."** Queried the `seo_strategies.error_message` column directly
  (via a one-off `pg` script placed in `lib/db/` — `pg` is only a direct dep there, not in
  `api-server`) to get the real error the 500-handler swallows: `AI response was not valid JSON`,
  with the raw text visibly cut off mid-string. Root cause: **Gemini 3.x models "think" before
  answering by default** (`thinkingConfig.thinkingLevel`, default `MEDIUM` for `gemini-3.6-flash`,
  `MINIMAL` for `gemini-3.1-flash-lite`), and thinking tokens are drawn from the *same*
  `maxOutputTokens` budget as the actual response — `seo.ts`'s schema is the largest structured-JSON
  prompt in the app but was capped at `maxTokens: 4000`, so thinking ate enough of that budget to
  truncate the JSON before it closed. Fixed in two places:
  1. `aiJson.ts`'s `callGemini()` now always sets `thinkingConfig: { thinkingLevel }` (imported
     `ThinkingLevel` enum from `@google/genai`, since raw strings aren't assignable to its type) —
     `generateJson` defaults to `"low"`, `generateJsonFast` defaults to `"minimal"`, both overridable
     per-call. Also added a clearer error message when `finishReason === "MAX_TOKENS"` is detected,
     instead of just a generic "not valid JSON" error.
  2. `seo.ts`'s `maxTokens` bumped from `4000` → `8000` as defense-in-depth (this schema alone
     justifies it; other routes — `contentGenerators.ts`, `sceneManager.ts`, `seo-tools.ts`,
     `support.ts` — have smaller schemas and weren't showing this symptom, but all benefit from the
     same `thinkingLevel` fix since none of them need deep multi-step reasoning).
  Verified with a smoke test replicating the exact SEO prompt/schema before redeploying:
  `finishReason: STOP` (not `MAX_TOKENS`), full valid JSON, all 8 expected top-level keys present,
  only ~1859 output tokens used against the new 8000 cap (previously silently truncating at 4000).
- **Follow-up #3 (same day): "Creative Image Studio" failed with `models/imagen-4.0-generate-001
  is no longer available to new users`.** Same "new users" gating pattern as gemini-2.5-flash, but
  this time it affects **every** Imagen 4.x tier (`-generate-001`, `-fast-generate-001`,
  `-ultra-generate-001` all 404 the same way for this key) — Imagen as a whole is a dead end for
  freshly-created API keys, not just one specific tier. Google's own SDK also emits a deprecation
  warning on every `generateImages()` call regardless: *"The generateImages method is deprecated...
  Please use the generateContent method with image models instead."* Migrated
  `lib/integrations-google-genai/src/image/client.ts` to `gemini-3.1-flash-image` via
  `generateContent()` + `responseModalities: ["IMAGE"]` + `imageConfig`.
  - **Separate, more fundamental gotcha found while testing the replacement: the Gemini API has
    ZERO free tier for image generation, period** — confirmed across all four candidate image
    models tested (`gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image`,
    `nano-banana-pro-preview`), every one returned `429 RESOURCE_EXHAUSTED` with
    `"limit": 0` on the free-tier quota metrics — this is Google's deliberate policy (confirmed via
    Google's own developer forum/docs), not a rate-limit or a wrong-model-name issue. **Google
    Cloud billing must be enabled on the project behind `GOOGLE_GENAI_API_KEY`** (console.cloud.
    google.com/billing) before any image generation call will succeed, independent of whatever
    quota the text models (`gemini-3.6-flash` etc.) already have — text and image billing/quota
    are governed separately. Added a `RESOURCE_EXHAUSTED`/`"limit":0` detector in
    `generateImageBuffer()`'s catch block that rewrites this specific error into an actionable
    message pointing at the billing console, instead of letting the raw Google JSON error blob
    reach the UI. **This is a genuine account/billing action for the human, not something fixable
    in code** — if image generation is still failing after a code deploy, check billing status
    first before assuming the model/API integration is broken again.
