#!/usr/bin/env bash
# LTX-2.5 one-render benchmark - render a single native-audio clip, timed.
# Usage: ./render.sh "your prompt"   (defaults to a GrowthForge-style test line)
# Verified against the Lightricks/LTX-2.5 model card (2026-11-13).
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-$HOME/LTX-2/models/ltx-2.5}"
REPO_DIR="${REPO_DIR:-$HOME/LTX-2}"
VRAM_GB="${VRAM_GB:-$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | awk '{print int($1/1024)}')}"
PROMPT="${1:-Photorealistic cinematic, cozy study room, a young Nigerian student smiles confidently at a tablet showing math, warm daylight, reassuring mood. Narrator voice says: \"Quantivarian delivers AI-powered lessons aligned with NERDC standards.\"}"
OUT="$HOME/ltx-output"
mkdir -p "$OUT"

# 80 GB (A100) -> bf16, no offload. 48 GB -> fp8 + CPU offload (needs >=128 GB RAM).
QUANT=""
if [ "$VRAM_GB" -lt 70 ]; then QUANT="--quantization fp8-cast --offload cpu"; fi
echo "VRAM ${VRAM_GB} GB -> quant flags: ${QUANT:-'(bf16, no offload)'}"

nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv -l 5 > "$OUT/gpu.csv" &
SMI_PID=$!

export PATH="$HOME/.local/bin:$PATH"
cd "$REPO_DIR"
source .venv/bin/activate

START=$(date +%s)
uv run python -m ltx_pipelines.distilled \
  --transformer-path     "$MODEL_DIR/diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors" \
  --text-encoder-path    "$MODEL_DIR/text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors" \
  --video-vae-path       "$MODEL_DIR/vae/ltx-2.5-video-vae-bf16.safetensors" \
  --audio-vae-path       "$MODEL_DIR/vae/ltx-2.5-audio-vae-bf16.safetensors" \
  --duration-head-path   "$MODEL_DIR/model_patches/ltx-2.5-duration-head-bf16.safetensors" \
  --spatial-upsampler-path "$MODEL_DIR/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" \
  --num-frames 121 \
  $QUANT \
  --prompt "$PROMPT" \
  --seed 42 \
  --output-path "$OUT/render.mp4"
END=$(date +%s)
kill "$SMI_PID" 2>/dev/null || true

echo "== result =="
echo "render_seconds=$((END-START))"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=duration -of default=noprint_wrappers=1 "$OUT/render.mp4" 2>/dev/null || true
echo "audio streams: $(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$OUT/render.mp4" 2>/dev/null | tr '\n' ' ')"
