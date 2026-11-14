#!/usr/bin/env bash
# In-instance watchdog (independent shutdown enforcement, layer 1 of 2).
#   - hard max runtime cap (default 4 h) -> stop self via instance-role creds
#   - idle timeout (default 15 min, heartbeat file) -> stop self
# Run as a systemd service on the worker. Uses IMDSv2 + the instance role.
set -u
MAX_RUNTIME_MIN="${MAX_RUNTIME_MIN:-120}"
IDLE_TIMEOUT_MIN="${IDLE_TIMEOUT_MIN:-15}"
HEARTBEAT="${HEARTBEAT:-/models/job/.heartbeat}"
REGION="${AWS_REGION:-us-east-1}"

TOKEN=$(curl -sS --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -sS --max-time 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
START_TS="${START_TS:-$(date +%s)}"
echo "[watchdog] armed instance=$INSTANCE_ID max=${MAX_RUNTIME_MIN}m idle=${IDLE_TIMEOUT_MIN}m"

stop_self() {
  echo "[watchdog] $(date -u) stopping $INSTANCE_ID (reason=$1)"
  aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --region "$REGION" || true
}

while true; do
  now=$(date +%s)
  uptime_min=$(( (now - START_TS) / 60 ))

  if [ "$uptime_min" -ge "$MAX_RUNTIME_MIN" ]; then
    stop_self "hard-cap ${MAX_RUNTIME_MIN}m"; exit 0
  fi

  if [ -f "$HEARTBEAT" ]; then
    age=$(( (now - "$(stat -c %Y "$HEARTBEAT")") / 60 ))
    if [ "$age" -gt "$IDLE_TIMEOUT_MIN" ]; then
      stop_self "idle ${IDLE_TIMEOUT_MIN}m"; exit 0
    fi
  fi

  sleep 60
done
