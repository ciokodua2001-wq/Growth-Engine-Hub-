#!/bin/bash
# Dedicated encrypted off-server backup for the GROWTHFORGE PRODUCTION database.
# Targets growthforge_prod ONLY (reads DATABASE_URL from the prod .env and
# refuses to run if it does not contain "growthforge_prod"). Encrypts with GPG
# AES256 and uploads to Wasabi under a prod-specific prefix.
set -euo pipefail

CREDS=/home/ubuntu/.wasabi-backup-creds.env
PASSPHRASE_FILE=/home/ubuntu/.backup-gpg-passphrase
PROD_ENV=/home/ubuntu/prod/app/.env
LOG=/home/ubuntu/backup-prod.log
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

[ -f "$CREDS" ] || { log "ERROR: missing $CREDS"; exit 1; }
[ -f "$PASSPHRASE_FILE" ] || { log "ERROR: missing $PASSPHRASE_FILE"; exit 1; }

source "$CREDS"
export AWS_ACCESS_KEY_ID="$WASABI_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$WASABI_SECRET_KEY"
EP="$WASABI_ENDPOINT"; case "$EP" in http*) ;; *) EP="https://$EP";; esac
PASSPHRASE=$(cat "$PASSPHRASE_FILE")
AWS=/snap/bin/aws

DB_URL=$(grep -oE '^DATABASE_URL=.*' "$PROD_ENV" | head -1 | cut -d= -f2- | tr -d '"')
DB_URL_LIBPQ=$(printf '%s' "$DB_URL" | sed -E 's/[?&]uselibpqcompat=true(&|$)/\1/; s/[?&]$//')

# Hard guard: never dump the wrong environment.
case "$DB_URL" in
  *growthforge_prod*) ;;
  *) log "ERROR: DATABASE_URL does not target growthforge_prod - aborting"; exit 1 ;;
esac

# Use pg_dump matching the RUNNING server's major version. A newer pg_dump
# (e.g. 18) emits SET parameters the older server does not understand
# (e.g. transaction_timeout), producing a dump that cannot be restored here.
SRV_MAJOR=$(psql "$DB_URL_LIBPQ" -tAc "SHOW server_version_num" 2>/dev/null | tr -d ' ' | cut -c1-2)
if [ -n "${SRV_MAJOR:-}" ] && [ -x "/usr/lib/postgresql/${SRV_MAJOR}/bin/pg_dump" ]; then
  PG_DUMP="/usr/lib/postgresql/${SRV_MAJOR}/bin/pg_dump"
else
  PG_DUMP=$(command -v pg_dump)
fi

log "Backing up growthforge_prod (prod) -> Wasabi (pg_dump $SRV_MAJOR)"

DUMP="$WORKDIR/growthforge_prod-${STAMP}.dump"
if "$PG_DUMP" "$DB_URL_LIBPQ" --no-owner --no-privileges -Fc -f "$DUMP" 2>>"$LOG"; then
  log "pg_dump OK ($(du -h "$DUMP" | cut -f1))"
else
  log "ERROR: pg_dump failed - aborting (no partial upload)"
  exit 1
fi

if [ ! -s "$DUMP" ]; then
  log "ERROR: dump file is empty - aborting"
  exit 1
fi
PG_BIN=$(dirname "$PG_DUMP")
if ! "$PG_BIN/pg_restore" --list "$DUMP" >/dev/null 2>>"$LOG"; then
  log "ERROR: dump is not a valid custom archive (pg_restore --list failed) - aborting"
  exit 1
fi
log "archive validated (pg_restore --list OK)"

ENC="$DUMP.gpg"
gpg --batch --yes --passphrase "$PASSPHRASE" --symmetric --cipher-algo AES256 -o "$ENC" "$DUMP"
log "Encrypted archive: $ENC ($(du -h "$ENC" | cut -f1))"

DEST="s3://${WASABI_BUCKET}/_infra-backups/growthforge-prod/$(date -u +%Y/%m)/growthforge_prod-${STAMP}.dump.gpg"
if "$AWS" s3 cp "$ENC" "$DEST" --endpoint-url "$EP" --region "$WASABI_REGION" --quiet 2>>"$LOG"; then
  log "Uploaded to $DEST"
else
  log "ERROR: Wasabi upload failed - aborting"
  exit 1
fi
log "Backup complete for growthforge_prod"
