#!/bin/bash
# Secure production owner-assignment for GrowthForge.
#
# Promotes ONE specific user (identified by email) to platform owner by setting
# users.is_owner = true. There is intentionally NO owner-registration endpoint
# and NO auto-promotion: this script must be run manually by an operator with
# direct DB access. It refuses to run on ambiguous or missing email matches.
#
# Usage:  bash assign-owner.sh <owner-email>
set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <owner-email>" >&2
  exit 1
fi
# Basic guard: reject anything that could break the SQL string.
case "$EMAIL" in
  *"'"*|*" "*|*";"*) echo "ABORT: invalid characters in email" >&2; exit 1 ;;
esac

CONN_INFO=/home/ubuntu/prod/app/.prod-db-connection
[ -f "$CONN_INFO" ] || { echo "ABORT: $CONN_INFO not found" >&2; exit 1; }

PASS=$(sed -E 's#.*:([^@]+)@.*#\1#' "$CONN_INFO" | head -1)
export PGPASSWORD="$PASS"
CONN="postgresql://growthforge_prod@127.0.0.1:5432/growthforge_prod"

MATCHES=$(psql "$CONN" -tAc "SELECT count(*) FROM users WHERE lower(email) = lower('$EMAIL');")
if [ "$MATCHES" != "1" ]; then
  echo "ABORT: expected exactly 1 user for '$EMAIL', found $MATCHES. No changes made." >&2
  exit 1
fi

psql "$CONN" -v ON_ERROR_STOP=1 -c \
  "UPDATE users SET is_owner = true, subscription_status = 'active', updated_at = now() WHERE lower(email) = lower('$EMAIL');"

echo "Promoted to owner:"
psql "$CONN" -c \
  "SELECT id, email, is_owner, role, subscription_status, can_access_dev, is_test_account FROM users WHERE lower(email) = lower('$EMAIL');"
echo "DONE"
