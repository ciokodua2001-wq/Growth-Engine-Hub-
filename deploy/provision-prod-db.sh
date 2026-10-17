#!/bin/bash
# Provision the production GrowthForge PostgreSQL database.
# Creates a dedicated role + database, applies the authoritative migration
# chain (0000_baseline -> 0001_better_auth) from the migration journal, and
# writes connection info to a chmod-600 file. Never prints the password.
set -euo pipefail

MIG_DIR="/home/ubuntu/prod/app/migrations-current"
CONN_INFO="/home/ubuntu/prod/app/.prod-db-connection"
ROLE="growthforge_prod"
DB="growthforge_prod"

echo "[1/5] Generating prod DB password (not shown)..."
PROD_DB_PASS=$(openssl rand -hex 24)

echo "[2/5] Creating/updating role ${ROLE}..."
ROLE_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${ROLE}'")
if [ "$ROLE_EXISTS" = "1" ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE ${ROLE} LOGIN PASSWORD '${PROD_DB_PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
  echo "  role exists - password reset"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE ${ROLE} LOGIN PASSWORD '${PROD_DB_PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
  echo "  role created"
fi

echo "[3/5] Creating database ${DB} (if absent)..."
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'")
if [ "$DB_EXISTS" = "1" ]; then
  echo "  database already exists"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB} OWNER ${ROLE};"
  echo "  database created"
fi

echo "[4/5] Applying migration chain..."
export PGPASSWORD="$PROD_DB_PASS"
CONN="postgresql://${ROLE}@127.0.0.1:5432/${DB}"
sed 's/--> statement-breakpoint//g' "$MIG_DIR/0000_baseline.sql"  | psql "$CONN" -v ON_ERROR_STOP=1 -f - >/dev/null
sed 's/--> statement-breakpoint//g' "$MIG_DIR/0001_better_auth.sql" | psql "$CONN" -v ON_ERROR_STOP=1 -f - >/dev/null
echo "  migrations applied (0000_baseline -> 0001_better_auth)"

echo "[5/5] Verifying schema..."
COUNT=$(psql "$CONN" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';")
echo "  public table count: ${COUNT} (expect 57)"
KEY=$(psql "$CONN" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('business_sources','analysis_sources','creator_profiles','meta_connections','meta_page_sessions','user','session','account','verification') ORDER BY tablename;")
echo "  key tables present:"
echo "$KEY" | sed 's/^/    /'

umask 077
{
  echo "DATABASE_URL=postgresql://${ROLE}:${PROD_DB_PASS}@127.0.0.1:5432/${DB}"
  echo "DIRECT_DATABASE_URL=postgresql://${ROLE}:${PROD_DB_PASS}@127.0.0.1:5432/${DB}"
} > "$CONN_INFO"
chmod 600 "$CONN_INFO"
echo "connection info written: $CONN_INFO (mode $(stat -c %a "$CONN_INFO"))"
echo "DONE"
