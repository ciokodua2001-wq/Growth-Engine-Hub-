# LTX-2.5 GPU benchmark - lowest-cost viable configs (revised)

Status: PLANNING ONLY. Nothing provisioned, nothing spent, production untouched.
Replaces the earlier AWS `g6e.8xlarge` ($4.53/hr) plan - rejected by owner.
Objective: ONE successful LTX-2.5 native audio/video render, ≤ $10 GPU compute, ≤ 5 h,
with an independent auto-termination safeguard.

## Verified pricing (checked 2026-11-13)

| Provider | GPU | VRAM | $/hr | Notes |
|---|---|---|---|---|
| **Runpod Community** | **A100 PCIe/SXM 80GB** | 80 GB | **$2.09 / $2.19** | bf16, no offload - most reliable |
| Runpod Community | L40S | 48 GB | $1.09 | fp8 + CPU offload |
| Runpod Community | L40 | 48 GB | $0.82 | fp8 + CPU offload (no native FP8) |
| Runpod Community | RTX A6000 | 48 GB | $0.69 | fp8 + CPU offload |
| **Vast.ai** (live market) | **L40S / A6000, ≥128GB RAM** | 48 GB | **~$0.30-0.60** | dynamic, per-second, filter by RAM |
| Vast.ai | A100 80GB | 80 GB | ~$0.60-1.20 | dynamic |
| Lambda | A100 80GB | 80 GB | $3.19 | **no A6000/L40S offered** |
| Lambda | A100 40GB | 40 GB | $1.99 | marginal VRAM |
| AWS g6e.4xlarge (spot) | L40S | 48 GB | ~$1.6-1.9 | 128 GB RAM, but still > Runpod |
| AWS g6e.xlarge (spot) | L40S | 48 GB | ~$1.5-1.9 | 32 GB RAM - **too small** for offload |

Lambda's " A6000 48GB" from the request is **not currently offered** - its live lineup
is B200/H100/A100/V100. A100 80GB there is $3.19/hr (worse than Runpod's $2.09).

## LTX-2.5 (22B) memory math - the thing that decides viability

- bf16: 22B transformer (44 GB) + Gemma-4 12B text encoder (24 GB) = 68 GB,
  + video/audio VAEs + 2× spatial upsampler + activations ⇒ ~75-80 GB.
  → **A100 80GB** runs it with no offload (use fp8 for the encoder to stay safe).
- fp8: transformer 22 GB + encoder 12 GB = 34 GB, + VAEs/upsampler ⇒ ~40-45 GB.
  → **48 GB** works only with `--quantization fp8-cast --offload cpu`, and the
  offloaded modules need **≥128 GB system RAM** (256 GB ideal).

## Resolution ladder (upscaling to 2K / 4K)

The spatial upsampler is **×2 per pass**; `--width/--height` are the FINAL output.

| Target | Flags | Notes |
|---|---|---|
| 1080p | `--width 1920 --height 1088 --spatial-upscalings 1` (default) | matches the commercial pipeline |
| 4K | `--width 3840 --height 2176 --spatial-upscalings 2` | documented; doubles upscale VRAM+time → **A100 80GB path** |
| 2K (2560×1440) | none native | not a clean ×2 of a ÷32 base; upscale 1080p→2K in ffmpeg, or render 4K→downscale |

1080p is supported on both paths: base ~960×544 (or 544×960) then the 2× spatial
upsampler → 1920×1088 (÷32 constraint; pad to 1920×1080 in ffmpeg after). 4K is
feasible on A100 80GB but adds a second upsampling pass (more VRAM + time); on the
48 GB fp8 path it is much higher risk.

## The two cheapest technically viable configs

### #1 (recommended - best cost per *successful* render): Runpod A100 80GB, ~$2.09/hr
- bf16 (fp8 encoder optional) → no OOM risk, no CPU-offload RAM gamble.
- Fastest render; a full 30 s commercial (4 × ~5 s clips) ≈ 30-60 min total.
- Realistic total for one successful render incl. setup+download: **~$4-5**.
- Network volume (weights): 100 GB @ $0.10/GB-mo ≈ prorated a few cents for a 5 h run;
  delete the volume after. Or download to ephemeral disk if the pod has ≥160 GB disk.

### #2 (cheapest hourly, higher risk): Vast.ai L40S/A6000 48GB with ≥128GB RAM, ~$0.30-0.60/hr
- fp8 + CPU offload; must filter listings by **system RAM ≥128 GB** (the single most
  important filter - offloading the 12B encoder + VAEs needs it).
- Slower per render; some OOM/slowdown risk; host reliability varies.
- Cheapest possible: a 5 h session ≈ **$1.50-3**.

Why not Lambda A6000: not offered. Why not Runpod RTX A6000 $0.69: cheapest 48GB but
pod RAM is host-fixed and may be <128 GB - verify at booking; prefer Vast for RAM control.

## Revised execution plan (≤ $10, ≤ 5 h, auto-terminate)

1. Pick machine; set a hard **5 h watchdog** BEFORE anything else (see scripts).
2. `scp` the prebuilt `scripts/gpu-benchmark/*` onto the box (zero billable setup time spent authoring).
3. Run `setup.sh` (~10 min): CUDA + `uv` + `ltx-pipelines` + download `Lightricks/LTX-2.5`
   weights (~80-100 GB, ~15-40 min on datacenter network).
4. Run `render.sh`: one 1080p native-audio clip (e.g. 121 frames ≈ 5 s), timed, with
   `nvidia-smi dmon` sampling.
5. Record: render time, resolution (ffprobe), audio present (ffprobe `aac`), GPU util/VRAM.
6. Watchdog auto-terminates at 5 h or on completion; verify the instance is destroyed.

## Budget math (worst case = full 5 h)

| Config | 5 h ceiling | Realistic one-render |
|---|---|---|
| Runpod A100 80GB | $10.45 | ~$4-5 |
| Vast L40S 48GB ≥128GB | $1.50-3 | ~$1-2 |

Both sit at or under the $10 target; cap the A100 session at 4.5 h ($9.40) to be strict.

## Hard rules (unchanged)

- No provisioning, no spend, no production changes without explicit approval.
- No AWS root credentials.
- Do not deploy LTX into the GrowthForge app server.
- No AWS Batch until the single-render benchmark succeeds.
