#!/usr/bin/env bash
# LTX-2.5 benchmark - independent auto-termination watchdog.
# Start it FIRST, before any billable work. Stops the rented instance after MIN
# minutes (or on a sentinel) using the provider's real "stop billing" API, so a
# forgotten Pod cannot keep charging.
#
# Usage:  MIN=300 ./watchdog.sh &          (auto-detects Runpod via env)
set -euo pipefail

MIN="${MIN:-300}"                       # hard ceiling (5 h default)
SENTINEL="${SENTINEL:-$HOME/.ltx-benchmark-done}"
# Auto-detect Runpod: its Pods export RUNPOD_POD_ID + a scoped RUNPOD_API_KEY that
# can only stop this Pod (not full account access), so it is safe to use here.
PROVIDER="${PROVIDER:-runpod}"          # runpod | vast | lambda | aws
INSTANCE_ID="${POD_ID:-${VAST_INSTANCE_ID:-${RUNPOD_POD_ID:-}}}"

echo "[watchdog] armed: ${MIN} min hard stop, provider=${PROVIDER:-none}, instance=${INSTANCE_ID:-?}"

destroy_instance() {
  echo "[watchdog] terminating rented instance (provider=${PROVIDER:-none})"
  case "$PROVIDER" in
    runpod)
      # Method 1: runpodctl (present in most Runpod base images).
      if command -v runpodctl >/dev/null 2>&1; then
        runpodctl stop pod "$INSTANCE_ID" 2>/dev/null || true
      fi
      # Method 2: direct GraphQL stopPod with the pod-scoped key. This is what
      # actually stops BILLING (a container shutdown alone does not).
      if [ -n "$RUNPOD_API_KEY" ] && [ -n "$INSTANCE_ID" ]; then
        curl -sS --max-time 20 -X POST https://api.runpod.io/graphql \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $RUNPOD_API_KEY" \
          -d "{\"query\":\"mutation { podStop(input: { podId: \\\"$INSTANCE_ID\\\" }) { id desiredStatus } }\"}" \
          >/dev/null 2>&1 || true
      fi
      ;;
    vast)    vastai destroy instance "$INSTANCE_ID" 2>/dev/null || true ;;
    lambda)  echo "[watchdog] lambda: use 'lambda stop' or UI - falling back to shutdown" ;;
    aws)     echo "[watchdog] aws: ec2-stop-instances via instance-id - falling back to shutdown" ;;
  esac
  # Guaranteed local halt regardless of provider API success.
  sudo shutdown -h now 2>/dev/null || sudo poweroff 2>/dev/null || true
}

# Tear down on success so the GPU doesn't idle past the work.
(
  while [ ! -f "$SENTINEL" ]; do sleep 15; done
  echo "[watchdog] sentinel seen - work complete, terminating now"
  destroy_instance
) &
WAIT_PID=$!

# Hard ceiling.
(
  sleep $((MIN * 60))
  echo "[watchdog] ${MIN} min ceiling reached - terminating now"
  destroy_instance
) &
CEIL_PID=$!

wait "$WAIT_PID"
