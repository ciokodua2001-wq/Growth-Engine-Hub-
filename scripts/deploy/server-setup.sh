#!/usr/bin/env bash
# GrowthForge — one-time bootstrap for a fresh Ubuntu Lightsail instance.
# Run once, right after first SSH login: `bash server-setup.sh`.
set -euo pipefail

echo "=== 1/6 apt update ==="
sudo apt-get update -y

echo "=== 2/6 base packages ==="
sudo apt-get install -y ca-certificates curl gnupg git build-essential ufw

echo "=== 3/6 Node.js 24.x (NodeSource) ==="
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
sudo corepack enable
sudo corepack prepare pnpm@latest --activate
pnpm -v

echo "=== 4/6 ffmpeg (video rendering pipeline — see lib/ffmpegAssembler.ts) ==="
sudo apt-get install -y ffmpeg
ffmpeg -version | head -n 1
ffprobe -version | head -n 1

echo "=== 5/6 Caddy ==="
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -y
sudo apt-get install -y caddy
caddy version

echo "=== 6/6 firewall ==="
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
sudo ufw status

echo "=== ALL DONE ==="
echo "Next: clone the repo into /home/ubuntu/dev/app and /home/ubuntu/prod/app,"
echo "copy scripts/deploy/Caddyfile to /etc/caddy/Caddyfile (fill in the basic-auth"
echo "hash first), copy scripts/deploy/coming-soon and dev-static into /home/ubuntu/,"
echo "and install the systemd units from scripts/deploy/systemd/. See docs/deployment.md."
