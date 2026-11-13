#!/usr/bin/env bash
# LTX-2.5 one-render benchmark - render a single 1080p native-audio clip, timed.
# Usage: ./render.sh "your prompt"   (defaults to a GrowthForge-style test line)
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-$HOME/models/LTX-2.5}"
VRAM_GB="${VRAM_GB:-$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | awk '{print int($1/1024)}')}"
PROMPT="${1:-Photorealistic cinematic, cozy study room, a young Nigerian student smiles confidently at a tablet showing math, warm daylight, reassuring mood. Narrator voice says: \"Quantivarian delivers AI-powered lessons aligned with NERDC standards.\"}"
OUT="$HOME/ltx-output"
mkdir -p "$OUT"

# Resolution ladder (spatial upsampler is x2 per pass; width/height = FINAL output):
#   1080p: WIDTH=1920 HEIGHT=1088 UPSCALINGS=1   (default, matches commercial pipeline)
#   4K:    WIDTH=3840 HEIGHT=2176 UPSCALINGS=2   (adds VRAM + time; use the A100 80GB path)
#   2K: no native x2 preset (2560x1440 isn't a clean 2x of a /32 base) — upscale
#       1080p->2K in ffmpeg, or render 4K and downscale.
WIDTH="${WIDTH:-1920}"; HEIGHT="${HEIGHT:-1088}"; UPSCALINGS="${UPSCALINGS:-1}"
# 48 GB -> fp8 + CPU offload; 80 GB -> bf16 (no offload).
QUANT=""
if [ "$VRAM_GB" -lt 70 ]; then QUANT="--quantization fp8-cast --offload cpu"; fi
echo "VRAM ${VRAM_GB} GB -> quant flags: ${QUANT:-'(none, bf16)'}"
echo "resolution: ${WIDTH}x${HEIGHT}, spatial-upscalings=${UPSCALINGS}"

# GPU utilization sampler in the background.
nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv -l 5 > "$OUT/gpu.csv" &
SMI_PID=$!

export PATH="$HOME/.local/bin:$PATH"
source "$HOME/ltx-venv/bin/activate"

START=$(date +%s)
# [CONFIRM] file names + that --width/--height mean FINAL output (not base) in this CLI.
uv run python -m ltx_pipelines.distilled \
  --transformer-path "$MODEL_DIR/diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors" \
  --text-encoder-path "$MODEL_DIR/text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors" \
  --video-vae-path "$MODEL_DIR/vae/ltx-2.5-video-vae-bf16.safetensors" \
  --audio-vae-path "$MODEL_DIR/vae/ltx-2.5-audio-vae-bf16.safetensors" \
  --spatial-upsampler-path "$MODEL_DIR/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" \
  --width "$WIDTH" --height "$HEIGHT" --spatial-upscalings "$UPSCALINGS" \
  --num-frames 121 \
  $QUANT \
  --prompt "$PROMPT" \
  --output-path "$OUT/render.mp4"
END=$(date +%s)
kill "$SMI_PID" 2>/dev/null || true

echo "== result =="
echo "render_seconds=$((END-START))"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=duration -of default=noprint_wrappers=1 "$OUT/render.mp4"
echo "audio streams: $(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$OUT/render.mp4" | tr '\n' ' ')"
