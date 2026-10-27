#!/usr/bin/env bash
# GrowthForge - Nigeria DEV deploy script.
# Runs ON the Lightsail box as the least-privilege `nigeria-deploy` user.
# Touches ONLY /home/ubuntu/nigeria/app and the `growthforge-nigeria-api`
# service. Never reads, writes, or reloads Global DEV / prod / Caddy / DB.
set -euo pipefail

APP_DIR="/home/ubuntu/nigeria/app"
BRANCH="feature/nigeria-paystack"
SERVICE="growthforge-nigeria-api.service"
PORT="4101"
LOG="[nigeria-deploy]"
LIVE_PUBLIC="$APP_DIR/artifacts/growthforge/dist/public"
RELEASES_DIR="$APP_DIR/.deploy-releases"
TMP_RELEASES="$RELEASES_DIR/tmp"

cd "$APP_DIR"
mkdir -p "$TMP_RELEASES"

PREV="$(git rev-parse HEAD)"
PREV_PUBLIC_TARGET="$(readlink "$LIVE_PUBLIC" 2>/dev/null || true)"

# Fast-forward only: never reset --hard here, never force. A diverged tree fails.
git fetch origin "$BRANCH" --quiet
git checkout --quiet "$BRANCH"
git merge --ff-only --quiet "origin/$BRANCH"
NEW="$(git rev-parse HEAD)"
RELEASE_DIR="$RELEASES_DIR/$NEW"
STAGE_DIR="$TMP_RELEASES/$NEW.$$"

echo "$LOG prev=$PREV new=$NEW"

if [ "$PREV" = "$NEW" ]; then
  echo "$LOG up to date, nothing to deploy"
  exit 0
fi

API_CHANGED=0
git diff --quiet "$PREV" "$NEW" -- artifacts/api-server lib pnpm-lock.yaml package.json || API_CHANGED=1
echo "$LOG api_changed=$API_CHANGED"

rollback() {
  echo "$LOG ROLLBACK to $PREV"
  git checkout --quiet "$BRANCH" || git checkout --quiet -B "$BRANCH"
  git reset --hard --quiet "$PREV"
  bash scripts/deploy/build.sh || true

  # Re-point the live frontend to the previously working release when known.
  if [ -n "$PREV_PUBLIC_TARGET" ] && [ -d "$PREV_PUBLIC_TARGET" ]; then
    rm -f "$LIVE_PUBLIC"
    ln -s "$PREV_PUBLIC_TARGET" "$LIVE_PUBLIC"
  fi

  sudo systemctl restart "$SERVICE" || true
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/healthz"; then
      echo "$LOG rollback health OK"
      return 0
    fi
    sleep 2
  done
  return 1
}

if ! bash scripts/deploy/build.sh; then
  echo "$LOG build failed"
  rollback || echo "$LOG rollback FAILED"
  exit 1
fi

# Atomic frontend publish: move the just-built public dir into a SHA-named
# release directory, then swap the live symlink in one rename step. Caddy keeps
# serving the old symlink target until the new one is fully ready.
test -s "$LIVE_PUBLIC/index.html" || { echo "$LOG frontend index missing after build"; rollback || true; exit 1; }
[ -d "$LIVE_PUBLIC/assets" ] || { echo "$LOG frontend assets missing after build"; rollback || true; exit 1; }
grep -rq "mo equivalent" "$LIVE_PUBLIC/assets/" || { echo "$LOG Nigeria pricing marker missing from built assets"; rollback || true; exit 1; }

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
mv "$LIVE_PUBLIC" "$STAGE_DIR/public"
rm -rf "$RELEASE_DIR"
mv "$STAGE_DIR" "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR/public" "$LIVE_PUBLIC.new"
mv -Tf "$LIVE_PUBLIC.new" "$LIVE_PUBLIC"

if [ "$API_CHANGED" = "1" ]; then
  sudo systemctl restart "$SERVICE"
fi

HEALTH_OK=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/healthz"; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [ "$HEALTH_OK" != "1" ]; then
  echo "$LOG health check failed"
  rollback || echo "$LOG rollback FAILED"
  exit 1
fi

echo "$LOG DEPLOY_OK new=$NEW api_restarted=$API_CHANGED public_target=$(readlink "$LIVE_PUBLIC")"
