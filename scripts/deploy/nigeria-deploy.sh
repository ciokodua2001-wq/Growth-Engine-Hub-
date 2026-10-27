#!/usr/bin/env bash
# GrowthForge - Nigeria DEV deploy script.
# Runs ON the Lightsail box as the least-privilege `nigeria-deploy` user.
# Touches ONLY /home/ubuntu/nigeria/app and the `growthforge-nigeria-api`
# service. Never reads, writes, or reloads Global DEV / prod / Caddy / DB.
#
# Invoked by .github/workflows/deploy-nigeria.yml over SSH.
set -euo pipefail

APP_DIR="/home/ubuntu/nigeria/app"
BRANCH="feature/nigeria-paystack"
SERVICE="growthforge-nigeria-api.service"
PORT="4101"
LOG="[nigeria-deploy]"

cd "$APP_DIR"

PREV="$(git rev-parse HEAD)"

# Fast-forward only: never reset --hard here, never force. A diverged tree fails.
git fetch origin "$BRANCH" --quiet
git checkout --quiet "$BRANCH"
git merge --ff-only --quiet "origin/$BRANCH"
NEW="$(git rev-parse HEAD)"

echo "$LOG prev=$PREV new=$NEW"

if [ "$PREV" = "$NEW" ]; then
  echo "$LOG up to date, nothing to deploy"
  exit 0
fi

# Determine what changed so we restart the API only when required.
API_CHANGED=0
git diff --quiet "$PREV" "$NEW" -- artifacts/api-server lib pnpm-lock.yaml package.json || API_CHANGED=1
FE_CHANGED=0
git diff --quiet "$PREV" "$NEW" -- artifacts/growthforge || FE_CHANGED=1
echo "$LOG api_changed=$API_CHANGED frontend_changed=$FE_CHANGED"

# Rollback restores the previous WORKING state on the box and leaves the local
# branch pointer at $PREV. origin/$BRANCH intentionally stays where it is (it is
# only advanced by pushes), so a later FIX commit pushed on top of the failed
# one still fast-forwards cleanly onto this branch. We never force-push origin.
rollback() {
  echo "$LOG ROLLBACK to $PREV"
  git checkout --quiet "$BRANCH" || git checkout --quiet -B "$BRANCH"
  git reset --hard --quiet "$PREV"
  bash scripts/deploy/build.sh || true
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

# Build API + frontend (build.sh injects PORT/BASE_PATH for Vite). .env is
# gitignored and never touched here, so DB/Paystack/credentials are preserved.
if ! bash scripts/deploy/build.sh; then
  echo "$LOG build failed"
  rollback || echo "$LOG rollback FAILED"
  exit 1
fi

# Restart the API only when api-server / lib / lockfile changed.
if [ "$API_CHANGED" = "1" ]; then
  sudo systemctl restart "$SERVICE"
fi

# Health check over loopback (bypasses the public Basic Auth gate).
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

# Frontend smoke: index.html + assets must exist (Caddy serves these from disk,
# no reload required), and the built bundle must contain the Nigeria pricing
# marker so we can never silently serve a stale/Global build.
test -s artifacts/growthforge/dist/public/index.html || { echo "$LOG frontend index missing"; rollback || true; exit 1; }
[ -d artifacts/growthforge/dist/public/assets ] || { echo "$LOG frontend assets missing"; rollback || true; exit 1; }
grep -rq "mo equivalent" artifacts/growthforge/dist/public/assets/ || { echo "$LOG Nigeria pricing marker missing from built assets"; rollback || true; exit 1; }

echo "$LOG DEPLOY_OK new=$NEW api_restarted=$API_CHANGED"
