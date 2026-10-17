#!/bin/bash
# Assemble the production .env: preserve every existing prod secret, swap in the
# new local PostgreSQL connection, and add a freshly-generated Better Auth secret
# + URL. Never prints secret values.
set -euo pipefail

ENV_FILE="/home/ubuntu/prod/app/.env"
CONN_INFO="/home/ubuntu/prod/app/.prod-db-connection"
TS=$(date -u +%Y%m%d-%H%M%S)

# 1. Backup current .env (already snapshotted in pre-deploy, but be extra safe)
cp -a "$ENV_FILE" "$ENV_FILE.bak-$TS"
chmod 600 "$ENV_FILE.bak-$TS"
echo "backed up .env -> $ENV_FILE.bak-$TS"

# 2. Load new DB connection strings (DATABASE_URL / DIRECT_DATABASE_URL)
source "$CONN_INFO"

# 3. Generate a fresh Better Auth secret (distinct from dev)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)

# 4. Remove existing lines for the keys we are (re)setting
sed -i -E '/^(DATABASE_URL|DIRECT_DATABASE_URL|BETTER_AUTH_SECRET|BETTER_AUTH_URL)=/d' "$ENV_FILE"

# 5. Append the new values
{
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "DIRECT_DATABASE_URL=${DIRECT_DATABASE_URL}"
  echo "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}"
  echo 'BETTER_AUTH_URL=https://usegrowthforge.com'
} >> "$ENV_FILE"

chmod 600 "$ENV_FILE"

echo "=== prod .env keys now ==="
grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/=$//' | sort | tr '\n' ' '
echo ""
echo "=== DB host/db (redacted) ==="
grep -E '^DATABASE_URL=' "$ENV_FILE" | sed -E 's#(://[^:/]+):[^@]+@#\1:****@#'
echo "=== Stripe mode (prefix only, value hidden) ==="
grep -E '^STRIPE_SECRET_KEY=' "$ENV_FILE" | sed -E 's/=(sk_test_|sk_live_|rk_test_|rk_live_)([a-zA-Z0-9]+).*/=\1****/' 
echo "DONE"
