---
name: Kling scene signed URL expiry
description: Scene video URLs stored in klingSceneJobsTable expire after 4h; assembler must re-sign before downloading.
---

## Rule

`klingSceneJobsTable.videoUrl` stores a signed GCS URL with a **4-hour TTL** (`ttlSec: 14_400`). The object name itself is NOT stored separately. When the assembler runs more than 4 hours after scene generation (or on a reassembly after a prior failure), those URLs return HTTP 400.

## Fix applied

`ffmpegAssembler.ts` has a `refreshSignedUrl(storedUrl)` helper that:
1. Detects if `storedUrl` starts with `https://storage.googleapis.com/`
2. Parses `pathname` → extracts `bucketName` (first path segment) and `objectName` (rest)
3. Calls `signObjectURL({ ..., ttlSec: 86_400 })` to get a fresh 24h URL
4. Falls back to the original URL on error

Called before every scene download inside `CommercialAssembler.assemble()`.

**Why:** No object name column in the schema — the raw GCS path is embedded in every signed URL, so we can parse it back out without a migration.

**How to apply:** Any other place that reads a stored GCS signed URL (narration, music, logo) and tries to download it after a delay should use the same helper.
