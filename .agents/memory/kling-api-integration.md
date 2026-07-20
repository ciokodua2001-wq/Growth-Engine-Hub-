---
name: Kling AI Developer API integration
description: Official Kling API endpoints, auth format, response shape, and architectural decisions for KlingCommercialRenderer
---

## Auth
- New API key format: `Authorization: Bearer KLING_API_KEY` (env var name)
- Legacy JWT (Access Key + Secret Key) only valid for models ≤ v3.0 — do NOT use for new integrations

## Base URL (non-China servers)
`https://api-singapore.klingai.com`

## Key endpoints
- Submit T2V: `POST /v1/videos/text2video`
- Poll status: `GET /v1/videos/text2video/{task_id}`
- List tasks: `GET /v1/videos/text2video?pageNum=1&pageSize=30`

## Request params
```json
{
  "model_name": "kling-v2-6",
  "prompt": "...",
  "negative_prompt": "...",
  "duration": "5",
  "mode": "std",
  "aspect_ratio": "16:9",
  "sound": "off",
  "external_task_id": "your-id"
}
```
- `duration`: string "5" or "10" (not a number)
- `mode`: "std" or "pro"
- `aspect_ratio`: "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21" — "4:5" NOT supported, map to "9:16"

## Response shape
```json
{
  "code": 0,
  "message": "success",
  "request_id": "...",
  "data": {
    "task_id": "...",
    "task_status": "submitted|processing|succeed|failed",
    "task_status_msg": "...",
    "task_result": {
      "videos": [{ "id": "...", "url": "...", "duration": "5" }]
    }
  }
}
```
- `code !== 0` = API-level error (still HTTP 200) — always check code
- Videos auto-purge after 30 days — download and store immediately on succeed

## Architecture decisions
- Scene jobs stored in `kling_scene_jobs` DB table (FK → videos, per-scene tracking)
- Each scene is submitted/polled independently — slow scenes don't block fast ones (Promise.allSettled)
- Batch size: 3 concurrent submissions to avoid rate-limit bursts
- Polling: 120 polls × 10s = 20 min max per scene
- DB updated at every status transition (pending → submitted → processing → succeed/failed)
- `checkKlingRequirements()` exported for render route availability gating
- `4:5` aspect ratio mapped to `9:16` (Kling doesn't support 4:5)

**Why:** Kling CDN URLs expire — must download buffer → upload to object storage immediately on succeed status, before returning the URL to callers.
