#!/usr/bin/env bash
# User-data bootstrap (runs once as root on first boot). Logs to /var/log/ltx-bootstrap.log.
# HF_TOKEN is injected by deploy.sh before upload.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
exec > /var/log/ltx-bootstrap.log 2>&1

apt-get update -y
apt-get install -y build-essential git curl python3 python3-venv ubuntu-drivers-common xfsprogs

# 1. NVIDIA driver (L40S / Ada). PyTorch wheels bring their own CUDA runtime.
ubuntu-drivers autoinstall || apt-get install -y nvidia-driver-550-server

# 2. Mount the attached data volume at /models (persists across stop/start).
mkdir -p /models
DEV=$(lsblk -dpno NAME,TYPE | awk '$2=="disk" && $1 !~ /sda/ {print $1; exit}')
if [ -n "$DEV" ]; then
  if ! blkid "$DEV" | grep -q ext4; then mkfs.ext4 -q "$DEV"; fi
  echo "$DEV /models ext4 defaults,nofail 0 2" >> /etc/fstab
  mount -a
fi

# 3. uv + LTX-2 repo + deps + weights (downloaded once, cached on EBS).
export PATH="$HOME/.local/bin:$PATH"
curl -LsSf https://astral.sh/uv/install.sh | sh
cd /models
[ -d LTX-2 ] || git clone https://github.com/Lightricks/LTX-2.git
cd LTX-2
uv sync
uv pip install "huggingface_hub[hf_transfer]"
mkdir -p /models/ltx-2.5
hf download Lightricks/LTX-2.5 \
  diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors \
  text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors \
  vae/ltx-2.5-video-vae-bf16.safetensors \
  vae/ltx-2.5-audio-vae-bf16.safetensors \
  model_patches/ltx-2.5-duration-head-bf16.safetensors \
  latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors \
  --local-dir /models/ltx-2.5 --token "$HF_TOKEN"

# 4. Install watchdog as a systemd service (hard 4h cap + idle timeout).
cat > /etc/systemd/system/ltx-watchdog.service <<'SVC'
[Unit]
Description=LTX worker shutdown watchdog
After=network.target
[Service]
ExecStart=/models/watchdog.sh
Restart=on-failure
Environment=MAX_RUNTIME_MIN=240
Environment=IDLE_TIMEOUT_MIN=15
Environment=HEARTBEAT=/models/job/.heartbeat
[Install]
WantedBy=multi-user.target
SVC
systemctl enable --now ltx-watchdog

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
touch /models/bootstrap.done
echo "BOOTSTRAP COMPLETE"
