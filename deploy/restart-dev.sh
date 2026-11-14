#!/usr/bin/env bash
# Restart the DEV API + FFmpeg assembly worker together, then health-check both.
#
# The FFmpeg worker is a SEPARATE systemd unit from the API server. It loads
# dist/ffmpeg-worker.mjs into memory at start, so rsync-ing a new dist only
# takes effect after BOTH units are restarted. Restarting just the API leaves
# the worker running the previous build (a bug we hit on 2026-11-13 when the
# speech-aware transition fix silently did nothing until the worker restarted).
set -euo pipefail

API_UNIT="growthforge-dev-api.service"
WORKER_UNIT="growthforge-ffmpeg-worker.service"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4001/api/healthz}"

echo "== restarting $API_UNIT and $WORKER_UNIT =="
sudo systemctl restart "$API_UNIT" "$WORKER_UNIT"
sleep 6

for unit in "$API_UNIT" "$WORKER_UNIT"; do
  state="$(systemctl is-active "$unit" || true)"
  echo "  $unit -> $state"
  [ "$state" = "active" ] || { echo "FAIL: $unit not active"; exit 1; }
done

echo "== health =="
curl -sS --max-time 10 "$HEALTH_URL"; echo
curl -sS --max-time 10 "http://127.0.0.1:4001/api/version"; echo

echo "== recent worker log =="
sudo journalctl -u "$WORKER_UNIT" --since "-20 seconds" --no-pager | tail -3 || true

echo "OK"
