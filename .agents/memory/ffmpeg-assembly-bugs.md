---
name: FFmpeg assembly duration + audio bugs
description: Two confirmed bugs in ffmpegAssembler.ts causing wrong output duration and silent audio.
---

## Bug 1 — Wrong duration (-t input flag ignored in filter_complex)

**Rule:** Never use `-t duration -i file` to trim scene clips when using `filter_complex` with `xfade`. It is unreliable — the trim is not applied before the filter graph reads the stream.

**Why:** Kling clips are 5-second. With 6 clips and 0.5s transitions, ignoring the trim gave 6×5−5×0.5=27.5s output instead of 15s. FFmpeg exit code was 0 so the error was invisible.

**Fix:** Use `trim=duration=X,setpts=PTS-STARTPTS` as the first element of the per-clip scale filter chain inside `filter_complex`. This is the authoritative trim point in the filter graph.

## Bug 2 — No sound (WAV narration saved with .mp3 extension)

**Rule:** When downloading a narration file to disk before passing to FFmpeg, always preserve the real file extension from the source URL path.

**Why:** OpenAI TTS narration is uploaded to GCS as `.wav` (object name ends in `.wav`). The assembler was saving it as `narration.mp3`. FFmpeg selects the MP3 demuxer based on extension, fails to parse WAV content, and silently produces an empty audio stream — FFmpeg still exits 0.

**Fix:** Extract extension from the URL path before the `?` query string: `.endsWith('.wav') ? 'wav' : 'mp3'`, then save as `narration.{ext}`.

## How to apply

Any time the assembler downloads audio for narration, check the extension first. Any time trimming scene video clips in filter_complex, use the `trim` filter, not `-t` input option.
