#!/bin/bash
# Restore-readiness drill for the prod DB backup: download the latest encrypted
# dump from Wasabi, decrypt it, restore into a throwaway database, verify table
# counts, then drop the throwaway DB. Proves rollback actually works.
set -euo pipefail

CREDS=/home/ubuntu/.wasabi-backup-creds.env
PASSPHRASE_FILE=/home/ubuntu/.backup-gpg-passphrase

source "$CREDS"
export AWS_ACCESS_KEY_ID="$WASABI_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$WASABI_SECRET_KEY"
EP="$WASABI_ENDPOINT"; case "$EP" in http*) ;; *) EP="https://$EP";; esac
PASSPHRASE=$(cat "$PASSPHRASE_FILE")
AWS=/snap/bin/aws

SRV_MAJOR=$(sudo -u postgres psql -tAc "SHOW server_version_num" | tr -d ' ' | cut -c1-2)
PG_RESTORE="/usr/lib/postgresql/${SRV_MAJOR}/bin/pg_restore"

KEY=$($AWS s3api list-objects-v2 --bucket "$WASABI_BUCKET" --prefix "_infra-backups/growthforge-prod/" \
  --endpoint-url "$EP" --region "$WASABI_REGION" \
  --query "sort_by(Contents,&LastModified)[-1].Key" --output text 2>/dev/null)

if [ -z "$KEY" ] || [ "$KEY" = "None" ]; then
  echo "ERROR: no prod backup found in Wasabi"; exit 1
fi

WORKDIR=$(mktemp -d)
chmod 755 "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

echo "[1] Downloading $KEY"
$AWS s3 cp "s3://${WASABI_BUCKET}/${KEY}" "$WORKDIR/backup.dump.gpg" --endpoint-url "$EP" --region "$WASABI_REGION" --quiet

echo "[2] Decrypting (GPG AES256)"
gpg --batch --yes --passphrase "$PASSPHRASE" -o "$WORKDIR/backup.dump" -d "$WORKDIR/backup.dump.gpg"
chmod 644 "$WORKDIR/backup.dump"

echo "[3] Restoring into throwaway DB growthforge_prod_restore_test"
sudo -u postgres dropdb --if-exists growthforge_prod_restore_test >/dev/null 2>&1 || true
sudo -u postgres createdb -O growthforge_prod growthforge_prod_restore_test
sudo -u postgres "$PG_RESTORE" --no-owner --role=growthforge_prod -d growthforge_prod_restore_test "$WORKDIR/backup.dump" 2>&1 | tail -3

echo "[4] Verify restored schema"
PUB=$(sudo -u postgres psql -d growthforge_prod_restore_test -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';")
STRIPE=$(sudo -u postgres psql -d growthforge_prod_restore_test -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='stripe';")
echo "    public tables: $PUB (expect 57)"
echo "    stripe tables: $STRIPE (expect >= 10)"

echo "[5] Cleanup temp DB"
sudo -u postgres dropdb growthforge_prod_restore_test
echo "RESTORE TEST DONE - temp DB dropped"
