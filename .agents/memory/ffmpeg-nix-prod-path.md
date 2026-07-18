---
name: FFmpeg Nix path resolution in production
description: Production Replit containers have a minimal PATH — which ffmpeg fails; must use extended PATH + nix store scan to find the binary reliably.
---

## Rule
Never rely on bare `which ffmpeg` (or just `"ffmpeg"`) in production. The prod container PATH does not include Nix store entries. Resolution strategy (in order):

1. Run `which ffmpeg` with an extended PATH that includes:
   `/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin`
2. If that fails, find the `replit-runtime-path` package in the nix store:
   `ls /nix/store | grep -m1 'replit-runtime-path'` → `/nix/store/<pkg>/bin/ffmpeg`
3. Final fallback: `find /nix/store -maxdepth 4 -name 'ffmpeg' -type f | head -1`
4. Also pass the extended PATH to every `spawn()` call's `env` so the binary is
   findable even if FFMPEG_BIN stays as the bare name.

Add a startup log (`logger.info({ ffmpegBin: FFMPEG_BIN }, "FFmpeg binary resolved")`)
so production deployments can confirm which path was found.

**Why:** Production containers start with a stripped PATH (no Nix store dirs).
Dev works because the nix-shell or similar sets PATH at shell launch, but the
production process doesn't get that environment setup.

**How to apply:** Any server-side binary that lives in the Nix store (ffmpeg,
ImageMagick, etc.) must use this pattern instead of a bare binary name.
