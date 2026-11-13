#!/usr/bin/env bash
# Single 5-second benchmark (C1): render + validate + S3 upload + integrity verify.
# Requires bootstrap.done. Run as root on the worker. Heartbeat keeps the watchdog from firing.
set -euo pipefail
MODEL_DIR=/models/ltx-2.5
REPO_DIR=/models/LTX-2
OUT=/models/job
S3KEY="benchmark-5s/render.mp4"
mkdir -p "$OUT"
export PATH="$HOME/.local/bin:$PATH"
cd "$REPO_DIR"; source .venv/bin/activate
HEARTBEAT="$OUT/.heartbeat"; touch "$HEARTBEAT"

# capture peak VRAM + system RAM during render
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -l 2 > "$OUT/gpu.csv" & SMIPID=$!
( while true; do free -b | awk '/Mem:/{print $3}'; sleep 2; done > "$OUT/ram.csv" ) & RAMPID=$!

START=$(date +%s)
uv run python -m ltx_pipelines.distilled \
  --transformer-path "$MODEL_DIR/diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors" \
  --text-encoder-path "$MODEL_DIR/text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors" \
  --video-vae-path "$MODEL_DIR/vae/ltx-2.5-video-vae-bf16.safetensors" \
  --audio-vae-path "$MODEL_DIR/vae/ltx-2.5-audio-vae-bf16.safetensors" \
  --duration-head-path "$MODEL_DIR/model_patches/ltx-2.5-duration-head-bf16.safetensors" \
  --spatial-upsampler-path "$MODEL_DIR/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" \
  --num-frames 121 --width 1920 --height 1088 \
  --quantization fp8-cast --offload cpu \
  --prompt "Cinematic aerial establishing shot over Victoria Island, Lagos at sunrise, slow descending crane movement toward a modern glass office tower, golden morning light on the skyline, traffic moving below, photorealistic live action, anamorphic, deep navy shadows, warm golden highlights. Ambient city audio, distant traffic, low electronic pulse." \
  --seed 11 --output-path "$OUT/render.mp4"
END=$(date +%s); kill $SMIPID $RAMPID 2>/dev/null || true; touch "$HEARTBEAT"

echo "render_seconds=$((END-START))"
echo "peak_vram_mib=$(sort -n "$OUT/gpu.csv" | tail -1)"
echo "peak_ram_bytes=$(sort -n "$OUT/ram.csv" | tail -1)"

# 1. MP4 validation (video + audio + resolution + duration)
V=$(ffprobe -v error -select_streams v -show_entries stream=codec_name,width,height -of csv=p=0 "$OUT/render.mp4")
A=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$OUT/render.mp4")
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/render.mp4")
[ -n "$V" ] && [ -n "$A" ] || { echo "VALIDATION FAIL: no video/audio stream"; exit 1; }
echo "video=[$V] audio=[$A] duration=$D"

# 2. S3 upload + integrity verify
SHA=$(sha256sum "$OUT/render.mp4" | cut -d' ' -f1)
SIZE=$(stat -c %s "$OUT/render.mp4")
aws s3 cp "$OUT/render.mp4" "s3://gf-ltx-output/$S3KEY" --checksum-algorithm SHA256
REMOTE_SIZE=$(aws s3api head-object --bucket gf-ltx-output --key "$S3KEY" --query ContentLength --output text)
REMOTE_SHA=$(aws s3api head-object --bucket gf-ltx-output --key "$S3KEY" --query ChecksumSHA256 --output text 2>/dev/null || true)
[ -n "$REMOTE_SHA" ] || REMOTE_SHA=$(aws s3 cp "s3://gf-ltx-output/$S3KEY" - | sha256sum | cut -d' ' -f1)
if [ "$SIZE" = "$REMOTE_SIZE" ] && [ "$SHA" = "$REMOTE_SHA" ]; then
  echo "S3 VERIFIED size=$SIZE sha256=$SHA"
else
  echo "S3 VERIFY FAIL local=($SIZE,$SHA) remote=($REMOTE_SIZE,$REMOTE_SHA)"; exit 1
fi

# 3. Mark complete (only now may the instance stop)
echo "uploaded+verified $(date -u) sha256=$SHA" > "$OUT/job-status.txt"
touch "$HEARTBEAT"
echo "DONE"
