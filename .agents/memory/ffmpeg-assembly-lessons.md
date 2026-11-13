---
name: FFmpeg Assembly Pipeline Lessons
description: Key findings and fixes from the commercial video assembly pipeline debugging
---

## Duration mismatch (Kling 5s clips → 15s commercial)

**Rule:** Kling always generates 5-second clips. The assembler must trim them to hit the target output duration.

**How to apply:** In `ffmpegAssembler.ts`, `sceneDuration` is computed as:
```
min(rawClipDuration, (TARGET_OUTPUT_DURATION_SEC + (n-1)*transition) / n)
```
Then `-t sceneDuration` is passed before each `-i sceneFile` as an FFmpeg input option.

**Why:** Without trimming, 6×5s clips = 27.5s instead of the advertised 15s.

---

## Scene audio (Kling clips have audio; assembler was stripping it)

**Rule:** When no `backgroundMusicUrl` or `narrationUrl` is provided, use original Kling scene audio via `aconcat` instead of `anullsrc` silence.

**How to apply:** Use `[i:a]atrim=0:{sceneDuration},asetpts=PTS-STARTPTS[ai]` for each scene, then `[a0][a1]...aconcat=n={n}:v=0:a=1,...[aout]`.

**Why:** The assembler was generating completely silent commercials by default.

---

## ASS captions — availability and positioning

**Rule:** `ass` filter IS compiled into the FFmpeg binary (libass available). But `Alignment: 7` (top-left) makes captions easy to miss. Use `Alignment: 2` (center-bottom, standard subtitle position).

**How to apply:** In `buildASSCaptions`, use alignment=2 in the Style line.

**Why:** Captions appeared to be absent but were just hidden in the corner.

---

## Kling non-English text

**Rule:** Kling (Kuaishou, Chinese company) generates scenes with Chinese/Asian characters in backgrounds. Must explicitly exclude in negative prompt.

**How to apply:** Add to `KLING_NEGATIVE_PROMPT`: `"Chinese characters, Japanese characters, Korean characters, Asian text, non-English text, foreign language text, written words, typography, subtitles, captions, on-screen text, signs with writing"`

**Why:** Default negative prompt only said "text overlay" which was insufficient to prevent Asian characters in generated scenes.

---

## Assembly stuck row recovery

**Rule:** ANY `commercial_assemblies` row with `status="processing"` at server startup is definitively orphaned — FFmpeg cannot survive a process restart. Reset ALL of them immediately, no age threshold.

**Why:** Previous 15-minute threshold meant rows stayed stuck if server restarted within 15 minutes of assembly starting (common during rapid deployments).

---

## pollAssembly must have a timeout

**Rule:** `pollAssembly` needs a hard timeout (8 minutes) to surface "Retry Assembly" if the assembly never completes. Also handle `overallStatus === "idle"` as an error rather than infinite loop.

**Why:** Without a timeout, users see an infinite spinner with no way to recover.

---

## Speech-aware transitions (2026-11-13)

**Rule:** `encodeFormat` must not use one fixed transition duration. Probe each
OUTGOING clip with `silencedetect` (`probeEndsInSilence`, -25dB). If it ends in
silence keep the user's requested crossfade; if speech/ambient runs to the last
frame (the common native-audio case), drop that boundary to 80ms. Video and
audio MUST share the same per-boundary duration or A/V drifts; offsets and
`totalOutputDuration` accumulate the per-boundary values.

**Why:** Omni/Kling native-audio clips often carry narration to the very last
frame. A fixed 500ms `acrossfade` at every boundary audibly swallowed the tail
of a spoken line mid-word. Measured: only 1 of 6 Omni clips ended in silence.
The long-term fix is in the decomposition prompt (narration must finish by
~7.0s leaving ~1s of ambient tail); the assembler change is the safety net.

## Deploys must restart BOTH the API and the FFmpeg worker

**Rule:** after rsync-ing `dist`, run `sudo systemctl restart
growthforge-dev-api.service growthforge-ffmpeg-worker.service` (or
`deploy/restart-dev.sh`). The worker is a separate unit
(`dist/ffmpeg-worker.mjs`) and keeps the old build in memory until restarted.

**Why:** on 2026-11-13 the speech-aware transition fix produced an unchanged
45.5s output and no new log line, because the assembly is claimed and encoded
by `growthforge-ffmpeg-worker.service`, which was still running the old code.
