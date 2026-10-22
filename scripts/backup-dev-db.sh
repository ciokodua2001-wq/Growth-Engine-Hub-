#!/usr/bin/env bash
set -euo pipefail

# Encrypted managed-DEV PostgreSQL backup -> Wasabi.
# Mirrors backup-prod-db.sh but targets growthforge_dev (managed Lightsail DB).
# Reads DATABASE_URL from the dev .env (least-privilege app role), strips the
# node-only uselibpqcompat param for libpq tools, uses the pg_dump matching the
# server major version, validates the archive, GPG-AES256 encrypts, uploads to
# Wasabi. Any failure => nonzero exit (no false-success artifact).

CREDS=/home/ubuntu/.wasabi-backup-creds.env
PASSPHRASE_FILE=/home/ubuntu/.backup-gpg-passphrase
DEV_ENV=/home/ubuntu/dev/app/.env
LOG=/home/ubuntu/backup-dev.log
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

[ -f "$CREDS" ] || { log "ERROR: missing $CREDS"; exit 1; }
[ -f "$PASSPHRASE_FILE" ] || { log "ERROR: missing $PASSPHRASE_FILE"; exit 1; }
# shellcheck disable=SC1091
source "$CREDS"
export AWS_ACCESS_KEY_ID="$WASABI_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$WASABI_SECRET_KEY"
EP="$WASABI_ENDPOINT"; case "$EP" in http*) ;; *) EP="https://$EP";; esac
PASSPHRASE=$(cat "$PASSPHRASE_FILE")
AWS=/snap/bin/aws

# Read DATABASE_URL; strip uselibpqcompat for libpq (psql/pg_dump).
DB_URL=$(grep -oE '^DATABASE_URL=.*' "$DEV_ENV" | head -1 | cut -d= -f2- | tr -d '"')
case "$DB_URL" in
  *growthforge_dev*) ;;
  *) log "ERROR: DATABASE_URL does not target growthforge_dev - aborting"; exit 1 ;;
esac
DB_URL_LIBPQ=$(printf '%s' "$DB_URL" | sed -E 's/[?&]uselibpqcompat=true(&|$)/\1/; s/[?&]$//')

# Use pg_dump/pg_restore matching the managed server's major version.
SRV_MAJOR=$(psql "$DB_URL_LIBPQ" -tAc "SHOW server_version_num" 2>/dev/null | tr -d ' ' | cut -c1-2)
if [ -n "${SRV_MAJOR:-}" ] && [ -x "/usr/lib/postgresql/${SRV_MAJOR}/bin/pg_dump" ]; then
  PG_BIN="/usr/lib/postgresql/${SRV_MAJOR}/bin"
else
  PG_BIN=$(dirname "$(command -v pg_dump)")
fi
log "Backing up growthforge_dev (managed, server $SRV_MAJOR) -> Wasabi"

DUMP="$WORKDIR/growthforge_dev-${STAMP}.dump"
if "$PG_BIN/pg_dump" "$DB_URL_LIBPQ" --no-owner --no-privileges -Fc -f "$DUMP" 2>>"$LOG"; then
  log "pg_dump OK ($(du -h "$DUMP" | cut -f1))"
else
  log "ERROR: pg_dump failed - aborting (no upload)"
  exit 1
fi

# Validate the archive is nonempty and structurally readable before encrypting.
if [ ! -s "$DUMP" ]; then
  log "ERROR: dump file is empty - aborting"
  exit 1
fi
if ! "$PG_BIN/pg_restore" --list "$DUMP" >/dev/null 2>>"$LOG"; then
  log "ERROR: dump is not a valid custom archive (pg_restore --list failed) - aborting"
  exit 1
fi
log "archive validated (pg_restore --list OK)"

ENC="$DUMP.gpg"
gpg --batch --yes --passphrase "$PASSPHRASE" --symmetric --cipher-algo AES256 -o "$ENC" "$DUMP"
rm -f "$DUMP"
log "Encrypted archive: $(du -h "$ENC" | cut -f1)"

DEST="s3://${WASABI_BUCKET}/_infra-backups/growthforge-dev/$(date -u +%Y/%m)/growthforge_dev-${STAMP}.dump.gpg"
if "$AWS" s3 cp "$ENC" "$DEST" --endpoint-url "$EP" --region "$WASABI_REGION" --quiet 2>>"$LOG"; then
  log "Uploaded to $DEST"
else
  log "ERROR: Wasabi upload failed - aborting"
  exit 1
fi
log "Backup complete for growthforge_dev"

# Rotation: delete growthforge-dev backups older than RETENTION_DAYS from Wasabi.
RETENTION_DAYS=30
CUTOFF=$(date -u -d "$RETENTION_DAYS days ago" +%Y-%m-%d)
"$AWS" s3 ls "s3://${WASABI_BUCKET}/_infra-backups/growthforge-dev/" --recursive --endpoint-url "$EP" --region "$WASABI_REGION" 2>/dev/null \
  | awk -v c="$CUTOFF" '$1 < c {print $4}' \
  | while read -r old; do
      if [ -n "$old" ]; then
        "$AWS" s3 rm "s3://${WASABI_BUCKET}/${old}" --endpoint-url "$EP" --region "$WASABI_REGION" --quiet
        log "rotated (deleted): $old"
      fi
    done
