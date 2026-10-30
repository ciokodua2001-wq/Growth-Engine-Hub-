# Global GrowthForge - Launch Cutover Procedure (PREPARED, NOT EXECUTED)

Status: **PREPARED - do not run without explicit owner approval.**
Release candidate: **`365df90f8f7c73185a01610a377c2fb992572b32`** (branch `release/global-prelaunch`)
Billing: **Monthly-only Stripe LIVE** (Starter $39, Get-Going $99, Growth $249, Agency $599).
Nigeria / Paystack: **out of scope - must remain untouched.**

This document separates two phases. **Phase A (preparation)** is safe to run now and
produces no external change. **Phase B (cutover)** is the set of actions that require
a single explicit owner "GO" - do not execute them as part of preparation.

---

## Phase A - Safe preparation (no owner approval required)

### A1. Release candidate identity
- SHA: `365df90f8f7c73185a01610a377c2fb992572b32`
- Branch: `release/global-prelaunch` (base `main` `a2122e9` + 4 commits:
  metrics fix, global trial/authz/image-gate fix, isolated test DB, pricing cleanup).
- Verified on this branch: api-server test suite **292/292**, monorepo typecheck **green**,
  api-server + frontend builds **green**.

### A2. Backup the current prod artifacts (idempotent)
```
ssh growthforge-prod 'sudo -n cp -a /home/ubuntu/prod/app/artifacts/api-server/dist \
  /home/ubuntu/prod/app/artifacts/api-server/dist.rollback-pre-global-365df90'
```
(Keeps the current Oct-17 prod build restorable without rebuilding.)

### A3. Stage the release build (does NOT restart anything)
On the prod host, from the release checkout:
```
# (promote the release branch, then) run the build script - builds only, no service change
cd /home/ubuntu/prod/app && git fetch && git checkout 365df90f8f7c73185a01610a377c2fb992572b32
bash scripts/deploy/build.sh   # builds api-server + frontend into dist/ only
```

### A4. Pre-verify prod DB is migration-safe (read-only)
```
# Two additive ADD COLUMN; confirm the columns are still missing (idempotent check)
psql "$(sudo -n grep -m1 '^DATABASE_URL=' /home/ubuntu/prod/app/.env | cut -d= -f2- | sed -E 's/[?&]uselibpqcompat=true(&|$)//')" \
  -Atc "select column_name from information_schema.columns where table_name='competitors' and column_name='superseded_at';"
```
Expect **0 rows** (column absent) - if already present, skip the migration.

---

## Phase B - Cutover (REQUIRES owner "GO")

### B0. Owner approval gate
Stop here. The following steps **enable live payments and switch the public domain**.
Proceed only after the owner explicitly approves launch.

### B1. Apply the forward-only migration
```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/reconcile-prod-schema.sql
```
Two `ADD COLUMN` only (`competitors.superseded_at`, `personas.superseded_at`). No DROP/TRUNCATE.

### B2. Inject the Stripe LIVE key (secure, non-printing)
The `rk_live_` restricted key lives in the project toolbox (root `.env`), never in git.
Replace only the `STRIPE_SECRET_KEY` line in prod `.env` atomically; **do not echo the key**:
```
python3 - <<'PY'
import os, re
key = [l.split("=",1)[1].strip() for l in open("/home/ubuntu/projects/growthforge/.env") if l.startswith("STRIPE_SECRET_KEY=")][0]
p = "/home/ubuntu/prod/app/.env"
s = open(p).read()
s = re.sub(r'(?m)^STRIPE_SECRET_KEY=.*$', 'STRIPE_SECRET_KEY=' + key, s)
# atomic replace + backup
os.rename(p, p + ".bak.pre-global-launch")
open(p, "w").write(s); os.chmod(p, 0o600)
PY
```
`STRIPE_WEBHOOK_SECRET` is **already set** (`whsec_`, prod webhook `we_1UT...HYaP`). Confirm it is unchanged.

### B3. Restart the prod API (no worker needed)
```
sudo -n systemctl restart growthforge-prod-api
```

### B4. Health + app smoke tests (must all pass)
```
API=https://127.0.0.1:4002
curl -sS $API/api/healthz          # {"status":"ok"}
curl -sS $API/api/version          # commit 365df90f8f7c73185a01610a377c2fb992572b32, env production
curl -sS $API/api/stripe/products  # 200, 4 monthly products (Starter/Get-Going/Growth/Agency)
# authenticated smoke: /api/auth/me, /api/projects, /api/projects/:id/videos, /api/projects/:id/videos/:vid/assemblies
```

### B5. Stripe checkout + webhook verification (no real charge)
- Confirm `/api/stripe/products` returns the 4 monthly price IDs (matches the approved $39/$99/$249/$599).
- Confirm the prod webhook `we_1UT...HYaP` is `enabled`, URL `https://usegrowthforge.com/api/stripe/webhook`, 4 events.
- (Optional, owner-approved) send a Stripe test event to the live endpoint only after Caddy cutover; do not run a real card.

### B6. Caddy cutover - Coming Soon → Global app
```
# In /etc/caddy/Caddyfile: comment out the "Coming Soon" usegrowthforge.com block
# and uncomment the "LAUNCHED" block (reverse_proxy localhost:4002 + prod dist/public).
sudo -n caddy validate --config /etc/caddy/Caddyfile
sudo -n systemctl reload caddy
```
Verify `https://usegrowthforge.com/` serves the app (not Coming Soon) and `/api/healthz` returns 200.

---

## Rollback triggers & commands

Trigger rollback on ANY of: failed migration, failed smoke test, 5xx on `/api/stripe/products`,
webhook returning non-200 to Stripe, or owner abort.

```
# 1. Revert Caddy to Coming Soon
sudo -n systemctl reload caddy   # after restoring the coming-soon block

# 2. Restore prior prod dist + restart
sudo -n cp -a /home/ubuntu/prod/app/artifacts/api-server/dist.rollback-pre-global-365df90 \
  /home/ubuntu/prod/app/artifacts/api-server/dist
sudo -n systemctl restart growthforge-prod-api

# 3. (optional) revert the two additive columns - non-destructive to data
# ALTER TABLE competitors DROP COLUMN superseded_at;
# ALTER TABLE personas     DROP COLUMN superseded_at;

# 4. (if live key must be rolled back) restore env backup
sudo -n cp /home/ubuntu/prod/app/.env.bak.pre-global-launch /home/ubuntu/prod/app/.env
```
The two `ADD COLUMN` are additive; leaving them in place is harmless if rollback stops before step 4.
