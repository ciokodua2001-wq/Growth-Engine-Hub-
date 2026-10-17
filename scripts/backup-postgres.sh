#!/usr/bin/env bash
set -euo pipefail

# Encrypted PostgreSQL backup for GrowthForge.
#   pg_dump -Fc  ->  gpg (AES256, symmetric passphrase)  ->  local retention
#   + optional Wasabi upload using a SEPARATE credential (BACKUP_S3_*).
#
# Never uses OBJECT_STORAGE_* (the media-storage credential). Credentials live
# in /etc/growthforge-backup.env (chmod 600), not in this script or the repo.

ENV_FILE="/etc/growthforge-backup.env"
BACKUP_DIR="/var/backups/growthforge"
DB_NAME="${BACKUP_DB_NAME:-growthforge_dev}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE (contains BACKUP_GPG_PASSPHRASE + optional BACKUP_S3_*)" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${BACKUP_GPG_PASSPHRASE:-}" ]; then
  echo "BACKUP_GPG_PASSPHRASE is not set in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/${DB_NAME}-${TS}.dump"
ENC="$DUMP.gpg"

# 1. Dump (custom format for pg_restore).
sudo -u postgres pg_dump -Fc -d "$DB_NAME" > "$DUMP"

# 2. Encrypt (AES256 symmetric) and remove the plaintext dump.
gpg --batch --yes --passphrase "$BACKUP_GPG_PASSPHRASE" --symmetric --cipher-algo AES256 "$DUMP"
rm -f "$DUMP"

# 3. Upload to Wasabi only if a SEPARATE backup credential is configured.
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ]; then
  export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-ca-central-1}"
  aws --endpoint-url "${BACKUP_S3_ENDPOINT:-https://s3.ca-central-1.wasabisys.com}" \
    s3 cp "$ENC" "s3://$BACKUP_S3_BUCKET/growthforge-dev/$(basename "$ENC")"
  echo "uploaded to Wasabi: $(basename "$ENC")"
else
  echo "Wasabi upload skipped (BACKUP_S3_* not configured) - encrypted dump kept at $ENC"
fi

# 4. Local retention (30 days).
find "$BACKUP_DIR" -name '*.gpg' -mtime +"$RETENTION_DAYS" -delete

echo "backup complete: $ENC"
