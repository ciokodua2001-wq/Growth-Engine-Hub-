#!/usr/bin/env bash
# LTX-2.5 benchmark - independent auto-termination watchdog.
# Start it FIRST, before any billable work. Kills the box (and, via the provider
# hook, destroys the rented instance) after MIN minutes unless a sentinel says done.
#
# Usage:  MIN=300 PROVIDER=runpod POD_ID=xyz ./watchdog.sh &
set -euo pipefail

MIN="${MIN:-300}"                       # hard ceiling (5 h default)
SENTINEL="${SENTINEL:-$HOME/.ltx-benchmark-done}"
PROVIDER="${PROVIDER:-}"                # runpod | vast | lambda | aws | (blank = local shutdown only)
INSTANCE_ID="${POD_ID:-${VAST_INSTANCE_ID:-}}"

echo "[watchdog] armed: ${MIN} min hard stop, provider=${PROVIDER:-none}"

destroy_instance() {
  echo "[watchdog] terminating rented instance (provider=${PROVIDER:-none})"
  case "$PROVIDER" in
    runpod) runpodctl stop pod "$INSTANCE_ID" 2>/dev/null || true ;;
    vast)    vastai destroy instance "$INSTANCE_ID" 2>/dev/null || true ;;
    lambda)  echo "[watchdog] lambda: use 'lambda stop' or UI - falling back to shutdown" ;;
    aws)     echo "[watchdog] aws: ec2-stop-instances via instance-id - falling back to shutdown" ;;
  esac
  # Guaranteed local halt regardless of provider CLI success.
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
