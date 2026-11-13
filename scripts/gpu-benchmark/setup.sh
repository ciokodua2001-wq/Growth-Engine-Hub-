#!/usr/bin/env bash
# LTX-2.5 one-render benchmark - setup (run once on the rented GPU).
# Pre-authored so billable setup time is minimal. Confirm the two lines marked
# [CONFIRM] against the model card's "ltx-pipelines installation" doc at run time
# (a 30-second check, zero cost) - package names move.
set -euo pipefail

HF_TOKEN="${HF_TOKEN:-}"                 # required to download Lightricks/LTX-2.5
MODEL_DIR="${MODEL_DIR:-$HOME/models/LTX-2.5}"
VRAM_GB="${VRAM_GB:-}"                    # auto-detected if empty

echo "== GPU =="
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
if [ -z "$VRAM_GB" ]; then
  VRAM_GB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | awk '{print int($1/1024)}')
fi
echo "detected VRAM ~${VRAM_GB} GB"
echo "system RAM: $(free -g | awk '/Mem:/{print $2}') GB"

echo "== deps =="
sudo apt-get update -qq && sudo apt-get install -y -qq build-essential git curl python3 python3-venv python3-pip
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

echo "== venv + torch (CUDA 12.4) =="
uv venv "$HOME/ltx-venv" --python 3.11
source "$HOME/ltx-venv/bin/activate"
uv pip install --upgrade pip
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124

echo "== ltx-pipelines =="
# [CONFIRM] exact install line (pip vs git) from the model card's install doc.
uv pip install ltx-pipelines || \
  uv pip install "ltx-pipelines @ git+https://github.com/Lightricks/ltx-pipelines.git"

echo "== download weights (~80-100 GB) =="
uv pip install "huggingface_hub[cli]"
if [ -z "$HF_TOKEN" ]; then echo "ERROR: set HF_TOKEN"; exit 1; fi
mkdir -p "$MODEL_DIR"
hf download Lightricks/LTX-2.5 --local-dir "$MODEL_DIR"

echo "== done =="
du -sh "$MODEL_DIR"
