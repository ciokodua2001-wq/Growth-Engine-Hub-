#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Vast.ai Serverless provisioning script — Wan 2.2 (14B, T2V-A14B + I2V-A14B)
#
# Runs on FIRST BOOT of every new worker created from the official "ComfyUI
# (Serverless)" template (see docs.vast.ai/guides/serverless/comfy-ui). The
# generic template ships ComfyUI + PyWorker + a Stable Diffusion 1.5 benchmark
# checkpoint, but downloads NO Wan weights on its own — that's what this
# script adds via the template's "Provisioning script" field.
#
# HOW TO USE:
#   1. Host this file somewhere Vast.ai can fetch by URL at boot (a raw GitHub
#      URL to this path in the repo works — must be a PUBLIC raw URL, or a
#      Gist raw URL if you'd rather not expose the repo).
#   2. In the Vast.ai console: Templates → ComfyUI (Serverless) → Edit →
#      "Provisioning script" → paste that raw URL.
#   3. Create the Workergroup / Endpoint from that edited template with:
#        min_workers=0, cold_workers=0 (or 1 if you want one warm spare),
#        inactivity_timeout=300  (scale to $0 after 5 idle minutes)
#      Hardware filter: 24GB+ VRAM GPU (RTX 4090/5090, A5000, L4-24GB, etc.)
#      — NOT an A100 80GB; the fp8-scaled ComfyUI workflow only needs ~24GB
#      because the high/low-noise experts are swapped sequentially, not held
#      in memory simultaneously. See .agents/memory/wan-vast-video-migration.md.
#   4. Set VAST_AI_ENDPOINT_ID in .env to the endpoint's name (the string you
#      pass as `endpoint` in the /route/ call — see wanRenderer.ts).
#   5. Also set S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET_NAME /
#      S3_ENDPOINT_URL as Vast.ai ACCOUNT-level env vars (Settings → Environment
#      Variables) OR rely on the per-request override wanRenderer.ts already
#      sends (Supabase S3-compatible credentials) — either works, the
#      per-request override always wins.
#
# Disk requirement: ~60GB for these 6 files alone; provision the instance
# with at least 100GB disk to leave room for ComfyUI itself + temp output.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-/workspace/ComfyUI}"
MODELS_DIR="${COMFYUI_DIR}/models"
HF_BASE="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"

mkdir -p "${MODELS_DIR}/diffusion_models" "${MODELS_DIR}/text_encoders" "${MODELS_DIR}/vae"

download_if_missing() {
  local url="$1"
  local dest="$2"
  if [ -f "$dest" ]; then
    echo "[wan22-provisioning] Already present, skipping: $dest"
    return 0
  fi
  echo "[wan22-provisioning] Downloading: $(basename "$dest")"
  # -C - resumes a partial download if the worker was interrupted mid-fetch.
  curl -L --fail --retry 5 --retry-delay 10 -C - -o "$dest" "$url"
}

# ── T2V (new scene cut) — high/low-noise expert pair ─────────────────────────
download_if_missing \
  "${HF_BASE}/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors" \
  "${MODELS_DIR}/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors"

download_if_missing \
  "${HF_BASE}/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors" \
  "${MODELS_DIR}/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"

# ── I2V (continuity from previous scene's last frame) — high/low-noise pair ──
download_if_missing \
  "${HF_BASE}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors" \
  "${MODELS_DIR}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"

download_if_missing \
  "${HF_BASE}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors" \
  "${MODELS_DIR}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"

# ── Shared text encoder + VAE (both T2V and I2V use these) ───────────────────
download_if_missing \
  "${HF_BASE}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
  "${MODELS_DIR}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"

download_if_missing \
  "${HF_BASE}/vae/wan_2.1_vae.safetensors" \
  "${MODELS_DIR}/vae/wan_2.1_vae.safetensors"

echo "[wan22-provisioning] Wan 2.2 14B model set ready (T2V-A14B + I2V-A14B, fp8_scaled)."
