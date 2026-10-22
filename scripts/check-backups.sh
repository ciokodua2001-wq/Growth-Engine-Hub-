#!/usr/bin/env bash
# Local backup status check - reports last successful backup age for dev + prod.
# Exit 0 if both succeeded within CUTOFF_HOURS, else exit 1 (missed/failed).
# LOCAL tracking only; no alert is delivered to anyone.
set -uo pipefail
CUTOFF_HOURS="${CUTOFF_HOURS:-26}"
rc=0
for env in dev prod; do
  LOG="/home/ubuntu/backup-${env}.log"
  if [ ! -f "$LOG" ]; then echo "MISSING_LOG ${env}"; rc=1; continue; fi
  last=$(grep "Backup complete" "$LOG" | tail -1)
  if [ -z "$last" ]; then echo "NO_SUCCESS ${env}"; rc=1; continue; fi
  ts=$(printf '%s' "$last" | cut -d']' -f1 | tr -d '[')
  epoch=$(date -u -d "$ts" +%s 2>/dev/null || echo 0)
  age_h=$(( ( $(date -u +%s) - epoch ) / 3600 ))
  if [ "$age_h" -gt "$CUTOFF_HOURS" ]; then
    echo "MISSED ${env}: last success ${age_h}h ago"; rc=1
  else
    echo "OK ${env}: last success ${age_h}h ago"
  fi
done
exit $rc
