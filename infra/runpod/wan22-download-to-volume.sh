#!/bin/bash
# One-time model-download script for RunPod Network Volumes.
#
# RunPod serverless workers mount an attached Network Volume at
# /runpod-volume, and the official `runpod/worker-comfyui` image expects
# ComfyUI models directly under /runpod-volume/models/... (NOT nested under
# a "ComfyUI/" folder — that's the Vast.ai convention, see
# infra/vast-ai/wan22-provisioning.sh for that variant).
#
# Run this ONCE on a plain Pod that has the same Network Volume attached at
# /workspace (Pods let you choose the mount path; Serverless workers do not).
# After this finishes, the volume can be attached to a Serverless endpoint
# and every worker will see the models pre-loaded at /runpod-volume/models/...
# with no download needed on cold start.
set -uo pipefail

MODELS_DIR="/workspace/models"
HF_BASE="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"

mkdir -p "${MODELS_DIR}/diffusion_models" "${MODELS_DIR}/text_encoders" "${MODELS_DIR}/vae"

download_if_missing() {
  local url="$1"
  local dest="$2"
  if [ -f "$dest" ]; then
    echo "Already present, skipping: $dest"
    return 0
  fi
  echo "Downloading: $(basename "$dest")"
  curl -L --fail --retry 5 --retry-delay 10 -C - -o "$dest" "$url"
  echo "Done: $(basename "$dest")"
}

download_if_missing "${HF_BASE}/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors" "${MODELS_DIR}/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors"
download_if_missing "${HF_BASE}/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors" "${MODELS_DIR}/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"
download_if_missing "${HF_BASE}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors" "${MODELS_DIR}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
download_if_missing "${HF_BASE}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors" "${MODELS_DIR}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
download_if_missing "${HF_BASE}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" "${MODELS_DIR}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
download_if_missing "${HF_BASE}/vae/wan_2.1_vae.safetensors" "${MODELS_DIR}/vae/wan_2.1_vae.safetensors"

echo "ALL_DOWNLOADS_COMPLETE"
du -sh "${MODELS_DIR}"
