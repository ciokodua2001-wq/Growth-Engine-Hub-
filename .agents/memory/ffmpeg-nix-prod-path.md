---
name: FFmpeg Nix path resolution in production
description: ffmpeg must be declared as a nix system dependency — not relied upon as a transitive dep of replit-runtime-path — so it is on PATH in both dev and production.
---

## Rule
Declare ffmpeg (and any other system binary the server needs) as an explicit nix
system dependency using `installSystemDependencies({ packages: ["ffmpeg"] })`.

Once declared, use `"ffmpeg"` as the binary name everywhere — no path guessing,
no `execSync("which ffmpeg")`, no nix-store scanning.

**Why:** The production container PATH is minimal. ffmpeg was only available in
dev because `replit-runtime-path` bundle happened to include it and the dev shell
inherits the full nix environment. Production starts with a stripped PATH, so
the binary was never found there regardless of any path manipulation at runtime.
The fix is to make the dependency explicit at the nix level, not to paper over
the gap with runtime heuristics.

**How to apply:** Any system binary the server calls (ffmpeg, imagemagick, etc.)
must be installed via `installSystemDependencies` in the package-management skill.
Never rely on transitive nix store deps being on PATH in production.
