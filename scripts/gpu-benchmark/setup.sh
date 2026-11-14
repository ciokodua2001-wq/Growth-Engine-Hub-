#!/usr/bin/env bash
# LTX-2.5 one-render benchmark - setup (run once on the rented GPU).
# Verified against the Lightricks/LTX-2.5 model card (2026-11-13):
#   install = git clone LTX-2 + `uv sync`; weights = 6 specific bf16 files.
set -euo pipefail

HF_TOKEN="${HF_TOKEN:-}"                 # required (gated model)
MODEL_DIR="${MODEL_DIR:-$HOME/LTX-2/models/ltx-2.5}"
REPO_DIR="${REPO_DIR:-$HOME/LTX-2}"

echo "== GPU =="
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
echo "system RAM: $(free -g | awk '/Mem:/{print $2}') GB"

echo "== deps =="
sudo apt-get update -qq && sudo apt-get install -y -qq build-essential git curl python3 python3-venv python3-pip
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv --version

echo "== clone LTX-2 (provides ltx_pipelines) =="
rm -rf "$REPO_DIR"
git clone https://github.com/Lightricks/LTX-2.git "$REPO_DIR"
cd "$REPO_DIR"
# Installs ltx_pipelines + torch (CUDA 12.7+) per the repo lockfile.
uv sync
uv pip install "huggingface_hub[hf_transfer]"   # ensures `hf` CLI + fast transfer
source .venv/bin/activate

echo "== download LTX-2.5 split weights (bf16 only, ~70 GB) =="
if [ -z "$HF_TOKEN" ]; then echo "ERROR: set HF_TOKEN"; exit 1; fi
mkdir -p "$MODEL_DIR"
hf download Lightricks/LTX-2.5 \
  diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors \
  text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors \
  vae/ltx-2.5-video-vae-bf16.safetensors \
  vae/ltx-2.5-audio-vae-bf16.safetensors \
  model_patches/ltx-2.5-duration-head-bf16.safetensors \
  latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors \
  --local-dir "$MODEL_DIR" --token "$HF_TOKEN"

echo "== done =="
du -sh "$MODEL_DIR"
