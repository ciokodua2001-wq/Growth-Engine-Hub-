#!/usr/bin/env bash
# Independent auto-termination safeguard (run on DEV, not the Pod).
# Stops the LTX benchmark Pod via the Runpod API after DEADLINE_SEC so a forgotten
# Pod cannot keep billing. This is the billing-stopping half; the in-Pod watchdog
# is only a container-halt fallback.
set -euo pipefail
POD_ID="${POD_ID:-qu8ff7a8r4ll56}"
DEADLINE_SEC="${DEADLINE_SEC:-18000}"     # 5 h
KEY="${RUNPOD_API_KEY:-$(cat "$HOME/.config/growthforge/runpod_api_key")}"
echo "[autostop] armed for pod $POD_ID, deadline ${DEADLINE_SEC}s ($(date -u))" >> /tmp/autostop.log
sleep "$DEADLINE_SEC"
echo "[autostop] $(date -u) firing podStop for $POD_ID" >> /tmp/autostop.log
curl -sS --max-time 30 -X POST https://api.runpod.io/graphql \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { podStop(input: { podId: \\\"$POD_ID\\\" }) { id desiredStatus } }\"}" \
  >> /tmp/autostop.log 2>&1 || true
echo "[autostop] $(date -u) done" >> /tmp/autostop.log
