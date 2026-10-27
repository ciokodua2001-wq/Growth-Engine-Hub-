#!/usr/bin/env bash
# One-time setup for the Nigeria DEV GitHub Actions deploy pipeline.
#
# Run ONCE on growthforge-box-8gb as the `ubuntu` user (with sudo):
#
#   sudo bash setup-nigeria-ci.sh /tmp/nigeria-deploy.pub /tmp/nigeria-deploy
#
#   arg1 = public key  (also registered as a READ-ONLY GitHub deploy key)
#   arg2 = private key (stored on the box for `git fetch`; also added to
#                       GitHub Actions secret NIGERIA_SSH_KEY)
#
# This script touches ONLY the Nigeria deploy user, the Nigeria app tree, a
# scoped sudoers entry, and a pnpm symlink. It never modifies Global DEV,
# prod, their services, databases, or the Caddy configuration.
set -euo pipefail

PUBKEY_FILE="${1:?public key path required}"
PRIVKEY_FILE="${2:?private key path required}"
APP_DIR="/home/ubuntu/nigeria/app"
USER="nigeria-deploy"
HOME_DIR="/home/$USER"

# 1. Least-privilege deploy user.
if ! id -u "$USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "GrowthForge Nigeria CI deploy" "$USER"
fi

# 2. SSH: authorized key (runner -> box) + deploy key (box -> GitHub fetch).
install -d -m 700 -o "$USER" -g "$USER" "$HOME_DIR/.ssh"
install -m 600 -o "$USER" -g "$USER" "$PUBKEY_FILE" "$HOME_DIR/.ssh/authorized_keys"
install -m 600 -o "$USER" -g "$USER" "$PRIVKEY_FILE" "$HOME_DIR/.ssh/id_ed25519"
cat > "$HOME_DIR/.ssh/config" <<'SSH'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
SSH
chown "$USER:$USER" "$HOME_DIR/.ssh/config"
chmod 600 "$HOME_DIR/.ssh/config"

# 3. Scoped sudo: restart/is-active/status of the Nigeria unit ONLY.
install -d -m 755 /etc/sudoers.d
cat > /etc/sudoers.d/nigeria-deploy <<'SUDO'
nigeria-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart growthforge-nigeria-api.service, /usr/bin/systemctl is-active growthforge-nigeria-api.service, /usr/bin/systemctl status growthforge-nigeria-api.service
SUDO
chmod 440 /etc/sudoers.d/nigeria-deploy

# 4. Targeted write access to the Nigeria tree only (POSIX ACL; no Global path).
command -v setfacl >/dev/null 2>&1 || apt-get install -y acl
setfacl -R -m "u:$USER:rwX" "$APP_DIR"
setfacl -R -m "d:u:$USER:rwX" "$APP_DIR"

# 5. Make pnpm available to the deploy user (node is already /usr/bin/node).
PNPM_BIN="$(command -v pnpm || true)"
if [ -n "$PNPM_BIN" ]; then
  ln -sf "$PNPM_BIN" /usr/local/bin/pnpm
else
  echo "WARN: pnpm not found on PATH; the deploy user needs it to build"
fi

# 6. Point the Nigeria repo at GitHub via the deploy key (this repo only).
cd "$APP_DIR"
git remote set-url origin git@github.com:ciokodua2001-wq/Growth-Engine-Hub-.git
sudo -u "$USER" git -C "$APP_DIR" fetch origin feature/nigeria-paystack --quiet && echo "git fetch as $USER OK"

# 7. Verify the Caddy static root + proxy (prints paths/ports only, no secrets).
echo "--- Caddy static roots ---"
grep -n "root \*" /etc/caddy/Caddyfile
echo "--- Caddy reverse_proxy targets ---"
grep -n "reverse_proxy" /etc/caddy/Caddyfile
echo
echo "Confirm the ng.dev block serves: root ${APP_DIR}/artifacts/growthforge/dist/public and proxy 127.0.0.1:4101"
