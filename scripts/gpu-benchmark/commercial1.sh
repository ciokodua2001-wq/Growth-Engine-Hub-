#!/usr/bin/env bash
# Commercial 1 - "THE FUTURE DOESN'T WAIT" (15s) E2E pilot.
# Renders 3 x ~5s shots with a locked Ada character description + native audio,
# then assembles + brand-overlays + trims to exactly 15.0s.
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-$HOME/LTX-2/models/ltx-2.5}"
REPO_DIR="$HOME/LTX-2"
OUT=/workspace/shots
mkdir -p "$OUT"
export PATH="$HOME/.local/bin:$PATH"
cd "$REPO_DIR"
source .venv/bin/activate

# font for the branding overlay (best-effort)
apt-get install -y -qq fonts-dejavu-core >/dev/null 2>&1 || true

render() {  # $1=prompt  $2=seed  $3=out
  local t0=$(date +%s)
  uv run python -m ltx_pipelines.distilled \
    --transformer-path "$MODEL_DIR/diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors" \
    --text-encoder-path "$MODEL_DIR/text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors" \
    --video-vae-path "$MODEL_DIR/vae/ltx-2.5-video-vae-bf16.safetensors" \
    --audio-vae-path "$MODEL_DIR/vae/ltx-2.5-audio-vae-bf16.safetensors" \
    --duration-head-path "$MODEL_DIR/model_patches/ltx-2.5-duration-head-bf16.safetensors" \
    --spatial-upsampler-path "$MODEL_DIR/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" \
    --num-frames 121 --width 1920 --height 1088 \
    --prompt "$1" --seed "$2" --output-path "$3"
  echo "[shot] $(basename "$3") render_seconds=$(( $(date +%s) - t0 ))"
}

echo "== shot 1 (establishing) =="
render "Cinematic aerial establishing shot over Victoria Island, Lagos at sunrise, slow descending crane movement toward a modern glass office tower, golden morning light on the skyline, traffic moving below, soft city reflection across glass windows, photorealistic live action, anamorphic, deep navy shadows, warm golden highlights, subtle lens bloom. Ambient city audio, distant traffic, low electronic pulse. Narrator voiceover: The future doesn't wait." 11 "$OUT/shot1.mp4"

echo "== shot 2 (Ada on camera) =="
render "Medium close-up of Ada, a confident Nigerian woman founder in her early 30s with warm brown skin, a tailored charcoal blazer over a cream blouse, natural braided updo hairstyle, standing in a bright modern office with soft window light. Slow dolly push-in from chest-up to head-and-shoulders, shallow depth of field, eye-level, calm determination. She turns to face the camera and speaks on camera: So why should we? Her voice clear and foregrounded, soft office ambience, music dips under her line." 12 "$OUT/shot2.mp4"

echo "== shot 3 (Ada declaration) =="
render "Low-angle medium shot of Ada, a confident Nigerian woman founder in her early 30s with warm brown skin, a tailored charcoal blazer over a cream blouse, natural braided updo, walking with purpose toward a bright glass doorway in a modern building, slow tracking movement, she glances toward the city skyline, cinematic contrast, golden highlights. Narrator voiceover: Quantivarian. Think beyond. Build tomorrow. Cinematic electronic rise, restrained impact." 13 "$OUT/shot3.mp4"

echo "== assemble + brand + trim to 15.0s =="
printf "file '%s/shot1.mp4'\nfile '%s/shot2.mp4'\nfile '%s/shot3.mp4'\n" "$OUT" "$OUT" "$OUT" > "$OUT/list.txt"
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
ffmpeg -y -f concat -safe 0 -i "$OUT/list.txt" -t 15.0 \
  -vf "drawtext=fontfile=$FONT:text='QUANTIVARIAN   THINK BEYOND':fontcolor=white:fontsize=54:x=(w-text_w)/2:y=h-160:box=1:boxcolor=black@0.4:boxborderw=18:enable='gte(t,13)'" \
  -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k \
  /workspace/quantivarian_15s.mp4

echo "== verify =="
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,sample_rate,channels -show_entries format=duration,size -of default=noprint_wrappers=1 /workspace/quantivarian_15s.mp4
echo "== done =="
