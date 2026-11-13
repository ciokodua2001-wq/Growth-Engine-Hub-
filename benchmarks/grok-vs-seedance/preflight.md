# Grok vs Seedance - Preflight Findings (corrected, read-only)

## xAI - Grok Imagine Video
- **Key:** ✅ authenticates (`api.x.ai`)
- **Model:** `grok-imagine-video-1.5-lite` (also `grok-imagine-video`, `-1.5`)
- **Spec:** 15 s · 9:16 · 720p · native audio + lip-synced speech
- **Price:** $0.03/sec → **$0.45 per 15 s**

## BytePlus ModelArk - Seedance (native audio CONFIRMED)
- **Region:** Asia Pacific - `https://ark.ap-southeast.bytepluses.com/api/v3`
- **Model:** `dreamina-seedance-2-5-260628` (latest enabled; also `-2-0-mini`, `-2-0-fast`, `-2-0`, `seedance-1-0-pro-fast`)
- **Native audio:** ✅ `generate_audio` request parameter, **default `true`** - synchronized dialogue/SFX/music, no external TTS or mux. (Earlier `output_modalities:["video"]` reading was incorrect and has been retracted.)
- **Endpoint:** `POST /api/v3/contents/generations/tasks`
- **Request params (our config):**
  ```json
  {
    "model": "dreamina-seedance-2-5-260628",
    "content": [{ "type": "text", "text": "<scene + exact dialogue>" }],
    "resolution": "720p",
    "ratio": "9:16",
    "duration": 15,
    "generate_audio": true,
    "watermark": false
  }
  ```
- **Pricing (720p, text-to-video, no video input):**
  - Token unit price: **$10.70 / 1M tokens** (`dreamina-seedance-2-5-260628`)
  - Token consumption ≈ `(0 + 15s) × 720 × 1280 × fps / 1024`
    - 24 fps → 324K tokens → **≈ $3.47 / 15 s**
    - 30 fps → 405K tokens → **≈ $4.33 / 15 s**
  - **Audio:** no separate line item - bundled into the video token consumption.
  - Exact figure confirms via `usage.completion_tokens` on the first generation or the official Seedance 2.5 calculator.

## Side-by-side cost (per 15 s video)
| Provider | Model | Native audio | Price / 15 s |
|---|---|---|---|
| xAI | grok-imagine-video-1.5-lite | ✅ native | **$0.45** |
| BytePlus | dreamina-seedance-2-5-260628 | ✅ native (`generate_audio`) | **≈ $3.47-4.33** |

## Benchmark total (2 videos: 1 Grok + 1 Seedance)
- **≈ $3.92 - $4.78** (Grok $0.45 + Seedance ~$3.47-4.33).

## Remaining limitation (unchanged, non-audio)
Both Quantivarian briefs are **4-shot with hard cuts + UI overlays + logo/URL**. Text-to-video (either provider) produces a **single continuous shot** - so a faithful 15 s ad needs 4 generations + ffmpeg assembly per provider, or a simplified single-shot version. This does not affect native audio; it affects shot structure and total cost (×4 if done faithfully).
