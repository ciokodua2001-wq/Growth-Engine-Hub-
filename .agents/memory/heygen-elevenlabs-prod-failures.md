---
name: HeyGen + ElevenLabs production render failures (historical — ElevenLabs removed)
description: Root causes and fixes for render pipeline failures on free-tier API accounts. ElevenLabs/OpenAI TTS was fully replaced by Google Cloud TTS (Chirp 3: HD) in the Google AI stack migration — kept for historical context only.
---

# HeyGen + ElevenLabs production render failures (historical)

**UPDATE:** As of the Google AI stack migration, ElevenLabs and the OpenAI TTS
fallback have been removed entirely. Narration now goes through
`@workspace/integrations-google-tts-server` (Google Cloud Text-to-Speech,
Chirp 3: HD voices, `en-CA`/`fr-CA`) via `artifacts/api-server/src/lib/googleNarrator.ts`
(commercial narrator) and `videoRenderPipeline.ts`'s `generateGoogleVoiceover()`
(avatar/character voiceover). There is no more free-plan/paid-plan split or
ElevenLabs→OpenAI fallback chain to worry about — Google Cloud TTS is billed
directly to the configured GCP project (`GOOGLE_CLOUD_PROJECT_ID` +
`GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING`, or `GOOGLE_GENAI_API_KEY` as a
simpler fallback). The notes below are preserved for historical context only
(e.g. if ElevenLabs/OpenAI code ever needs to be referenced from git history).

## ElevenLabs — free plan blocks all library voices via API (historical)

**Rule:** ElevenLabs free plan returns 402 for ALL premade/library/professional voices via API. Only self-cloned (IVC) voices work on free — and the account may have none.

**Why:** The production ELEVENLABS_API_KEY was on a free plan. The dev key was on a paid plan, so direct curl tests from dev succeeded (200 OK with valid audio) while production always 402'd. The 402 response body included `"paid_plan_required"`.

**How it was applied (removed):** `generateElevenLabsVoiceover` caught `ElevenLabsPlanError` (thrown on 402/403) and fell back to OpenAI `gpt-audio` TTS via `@workspace/integrations-openai-ai-server/audio`'s `textToSpeech()`. Gender mapping: female → `nova`, male/neutral → `onyx`. This entire code path no longer exists.

## HeyGen — `/v2/avatars` hangs when account has no studio avatars

**Rule:** `GET /v2/avatars` hangs completely (HTTP 000, never closes) when the HeyGen account has no uploaded studio avatars. Do NOT use a 15-second timeout — use 5 seconds max.

**Why:** The account has API credits (`remaining_quota: 288`) and the key is valid, but `/v1/avatar.list` returns 403 and `/v2/avatars` hangs indefinitely. The endpoint appears to block rather than return an empty list.

**How to apply:** `resolveDefaultHeyGenAvatar` returns `null` (not throw) on timeout or 4xx — cached to `_cachedDefaultAvatarId = null` so subsequent calls skip the fetch entirely. `generateHeyGenVideo` treats null as "no studio avatar" and throws a clear user-facing error: "No presenter photo uploaded. Please upload your photo in the Your Actor section." The catch block in `runRenderPipeline` passes user-facing errors through unchanged (checks for "upload" keyword).

Note: as of this migration, HeyGen is not actively wired into any api-server route (no live call sites found) — this section is kept in case the avatar-video feature is reintroduced.

## Dev vs prod environment differences

- Google Cloud TTS / Gemini: same GCP project and credentials are shared between dev and prod (see docs/deployment.md §Architecture) — no free/paid split like ElevenLabs had.
- HeyGen API key: same key works for video generation but `/v2/avatars` behavior differs based on account avatar library contents (historical, feature not currently wired up).
- Always check production deployment logs (`fetch_deployment_logs`) to get actual errors — dev curl tests can give false positives due to different API account tiers/regions.
