#!/usr/bin/env bash
# GrowthForge — builds the api-server + frontend in the current checkout
# (run this inside /home/ubuntu/dev/app or /home/ubuntu/prod/app, whichever
# slot you're deploying). See docs/deployment.md for the full promotion
# workflow.
set -euo pipefail

cd "$(dirname "$0")/../.."

# The Lightsail Nano tier (512MB RAM) undersizes V8's default heap limit —
# vite build (rollup/esbuild transform of the whole app) OOMs well before
# hitting the 2GB swap file added in server-setup.sh. Force a larger heap;
# the extra headroom spills into swap rather than crashing. Harmless (and a
# no-op in practice) on boxes with more RAM.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=1536"

echo "=== Installing dependencies ==="
pnpm install --frozen-lockfile

echo "=== Building api-server ==="
pnpm --filter @workspace/api-server run build

# vite.config.ts requires PORT to be set even for a one-shot build (it's
# never actually bound during `vite build`) — any value works.
echo "=== Building growthforge (base path: /) ==="
PORT=9999 BASE_PATH=/ pnpm --filter @workspace/growthforge run build

echo "=== Build complete ==="
