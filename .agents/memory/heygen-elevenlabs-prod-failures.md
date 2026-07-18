---
name: HeyGen + ElevenLabs production render failures
description: Root causes and fixes for render pipeline failures on free-tier API accounts
---

# HeyGen + ElevenLabs production render failures

## ElevenLabs — free plan blocks all library voices via API

**Rule:** ElevenLabs free plan returns 402 for ALL premade/library/professional voices via API. Only self-cloned (IVC) voices work on free — and the account may have none.

**Why:** The production ELEVENLABS_API_KEY is on a free plan. The dev key is on a paid plan, so direct curl tests from dev succeed (200 OK with valid audio) while production always 402s. The 402 response body includes `"paid_plan_required"`.

**How to apply:** `generateElevenLabsVoiceover` catches `ElevenLabsPlanError` (thrown on 402/403) and falls back to OpenAI `gpt-audio` TTS via `@workspace/integrations-openai-ai-server/audio`'s `textToSpeech()`. The `isRetryable()` check in `withRetry` naturally skips retries for `ElevenLabsPlanError`. Gender mapping: female → `nova`, male/neutral → `onyx`.

## HeyGen — `/v2/avatars` hangs when account has no studio avatars

**Rule:** `GET /v2/avatars` hangs completely (HTTP 000, never closes) when the HeyGen account has no uploaded studio avatars. Do NOT use a 15-second timeout — use 5 seconds max.

**Why:** The account has API credits (`remaining_quota: 288`) and the key is valid, but `/v1/avatar.list` returns 403 and `/v2/avatars` hangs indefinitely. The endpoint appears to block rather than return an empty list.

**How to apply:** `resolveDefaultHeyGenAvatar` returns `null` (not throw) on timeout or 4xx — cached to `_cachedDefaultAvatarId = null` so subsequent calls skip the fetch entirely. `generateHeyGenVideo` treats null as "no studio avatar" and throws a clear user-facing error: "No presenter photo uploaded. Please upload your photo in the Your Actor section." The catch block in `runRenderPipeline` passes user-facing errors through unchanged (checks for "upload" keyword).

## Dev vs prod environment differences

- ElevenLabs API key: dev = paid plan, prod = free plan → same key environment variables, different accounts
- HeyGen API key: same key works for video generation but `/v2/avatars` behavior differs based on account avatar library contents
- Always check production deployment logs (`fetch_deployment_logs`) to get actual errors — dev curl tests can give false positives due to different API account tiers
