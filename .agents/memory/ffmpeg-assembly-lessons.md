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
