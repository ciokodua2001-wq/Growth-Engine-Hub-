# Deployment Guide — GrowthForge

This document covers the dev/prod security architecture, AWS Lightsail provisioning, and the
promotion workflow for self-hosting GrowthForge (`usegrowthforge.com`).

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Access control model](#2-access-control-model)
3. [Provisioning the Lightsail instance](#3-provisioning-the-lightsail-instance)
4. [DNS configuration](#4-dns-configuration)
5. [Server bootstrap](#5-server-bootstrap)
6. [First deploy (dev slot)](#6-first-deploy-dev-slot)
7. [Environment variable reference](#7-environment-variable-reference)
8. [Approving dev-environment users](#8-approving-dev-environment-users)
9. [Promotion workflow (dev → prod)](#9-promotion-workflow-dev--prod)
10. [Rollback](#10-rollback)
11. [Monitoring](#11-monitoring)

---

## 1. Architecture overview

GrowthForge runs on **one dedicated AWS Lightsail instance** (not shared with any other
project), with **two independent api-server processes** — dev and prod — behind a single
Caddy reverse proxy that routes by hostname:

```
                              Internet
                                 │
                                 ▼
                     Caddy (auto‑HTTPS, :80/:443)
                    ┌────────────┴────────────┐
                    │                         │
        dev.usegrowthforge.com        usegrowthforge.com / www
        (Basic Auth + noindex)         (public — Coming Soon until launch)
                    │                         │
        ┌───────────┼───────────┐   ┌─────────┴─────────┐
        │           │           │   │                   │
   /api/* ───▶ dev api-server   │   │  (pre-launch: static Coming Soon page,
   (:4001)         │            │   │   no app/API served at all)
        │     Supabase auth +   │   │
        │     canAccessDev gate │   │  (post-launch: swap to prod api-server
        │           │           │   │   on :4002 + prod static builds — see
        └──▶ growthforge build ─┘   │   §9 Promotion workflow)
             (dist/public, "/")     └───────────────────┘

Both dev and prod api-server processes connect to the SAME Supabase project
(one Postgres DB, one Auth user pool) — see §2 for why, and §7 for how
render-job/asset storage still stays isolated between them.
```

Directory layout on the box:

```
/home/ubuntu/dev/app/     — dev slot: full git checkout, built, running on :4001
/home/ubuntu/prod/app/    — prod slot: full git checkout, built, running on :4002
/home/ubuntu/coming-soon/ — static pre-launch page (scripts/deploy/coming-soon)
/home/ubuntu/dev-static/  — dev-only robots.txt override (Disallow: /)
```

**Why one Supabase project, not two:** GrowthForge hasn't launched yet, so there is no real
customer data to protect from dev experiments. Splitting into `growthforge-dev` +
`growthforge-prod` Supabase projects later (once there's real prod data worth isolating) is a
config-only change — nothing in the app code assumes a single project.

**Why one Lightsail instance, not two:** cheaper at this pre-launch stage, and isolation is
already enforced at other layers (Supabase auth + `canAccessDev`, separate storage path
prefixes) rather than network segmentation. GrowthForge does **not** share this instance with
any other project (e.g. Quantivarian) — it gets its own box for full isolation from the rest of
the portfolio, and hosts GrowthForge only (no other products bundled in).

---

## 2. Access control model

| Layer | Mechanism | Protects against |
|---|---|---|
| Network (Caddy) | `X-Robots-Tag: noindex, nofollow` header + dev-only `robots.txt` (`Disallow: /`) | Search indexing |
| App (frontend) | `DevEnvironmentBanner` — visible on every page | User confusion between dev/prod |
| App (frontend) | `DevAccessGate` — blocks all routes (including the landing page) unless signed in via Supabase **and** admin-approved | Anyone who discovers the dev URL but has no approved account |
| App (backend) | `requireDevAccess` middleware (`APP_ENV=development` only) — blocks all `/api/*` except sign-in/provisioning unless `users.canAccessDev = true` | Direct API calls that bypass the frontend |
| Production | Caddy serves a static Coming Soon page for `usegrowthforge.com` — no proxy to any app/API at all | Public discovery of unfinished features before launch |

**Note:** an earlier revision also put HTTP Basic Auth in front of `dev.usegrowthforge.com` as
a network-level lock on top of the app-level gate above. It was removed — native browser Basic
Auth prompts fire per-resource (main document, XHRs to `/api/*`, etc.) and stacked confusingly
across OAuth redirects. See the comment above the `dev.usegrowthforge.com` block in the
checked-in `Caddyfile` for the full rationale. None of the remaining layers rely on the dev URL
being obscure.

---

## 3. Provisioning the Lightsail instance

Manual steps (AWS Console → Lightsail — no AWS CLI is configured in this workspace, so this is
done via the browser):

1. Go to **https://lightsail.aws.amazon.com/** → **Create instance**.
2. **Instance location**: change region to **Canada (Central) — `ca-central-1`** (matches the
   Supabase database region, minimizing app-server ↔ DB latency).
3. **Platform**: Linux/Unix.
4. **Blueprint**: OS Only → **Ubuntu 24.04 LTS**.
5. **Instance plan**: cheapest tier — **Nano, $5/mo** (512 MB RAM, 1 vCPU, 20 GB SSD). Resize
   later (Lightsail supports vertical resize with a brief reboot) if rendering workloads need
   more RAM/CPU.
6. **Identify your instance**: name it e.g. `growthforge-prod-box` (it hosts both the dev and
   prod slots, so avoid a name that implies only one).
7. Click **Create instance**.
8. Once running, go to the instance → **Networking** tab:
   - Attach a **Static IP** (free while attached to a running instance) — without this, the IP
     changes on reboot and breaks DNS.
   - Firewall rules: **SSH (22)**, **HTTP (80)**, **HTTPS (443)** open. Leave everything else
     closed — the api-server ports (4001/4002) are only reached via `localhost` by Caddy, never
     exposed publicly.
9. Download the default SSH key pair (or upload your own under **Account → SSH keys**) so you
   can `ssh ubuntu@<static-ip>`.

---

## 4. DNS configuration

At your DNS provider for `usegrowthforge.com`, add A records pointing at the Lightsail static IP:

| Host | Type | Value |
|---|---|---|
| `usegrowthforge.com` (apex/`@`) | A | `<static-ip>` |
| `www.usegrowthforge.com` | A (or CNAME to apex) | `<static-ip>` |
| `dev.usegrowthforge.com` | A | `<static-ip>` |

Caddy provisions its own Let's Encrypt certificates automatically for every hostname listed in
the Caddyfile the first time it starts — no manual certbot step needed, as long as DNS is
already pointing at the box before Caddy starts.

---

## 5. Server bootstrap

```bash
ssh ubuntu@<static-ip>
git clone <repo-url> /home/ubuntu/dev/app       # dev slot
git clone <repo-url> /home/ubuntu/prod/app      # prod slot (separate checkout!)
bash /home/ubuntu/dev/app/scripts/deploy/server-setup.sh
```

`server-setup.sh` installs Node 24, pnpm, **ffmpeg/ffprobe** (required by the video-rendering
pipeline — `artifacts/api-server/src/lib/ffmpegAssembler.ts`), Caddy, and configures `ufw`.
No local Postgres is installed — GrowthForge uses Supabase-hosted Postgres exclusively.

Copy the static assets Caddy needs directly (outside both git checkouts):

```bash
cp -r /home/ubuntu/dev/app/scripts/deploy/coming-soon /home/ubuntu/coming-soon
cp -r /home/ubuntu/dev/app/scripts/deploy/dev-static /home/ubuntu/dev-static
```

Install the Caddyfile and systemd units:

```bash
sudo cp /home/ubuntu/dev/app/scripts/deploy/Caddyfile /etc/caddy/Caddyfile
sudo cp /home/ubuntu/dev/app/scripts/deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now growthforge-dev-api
sudo systemctl enable --now growthforge-prod-api
sudo systemctl reload caddy
```

---

## 6. First deploy (dev slot)

```bash
cd /home/ubuntu/dev/app
cp scripts/deploy/dev.env.example .env      # then fill in real secrets
bash scripts/deploy/build.sh
sudo systemctl restart growthforge-dev-api
```

Verify:

```bash
curl https://dev.usegrowthforge.com/api/healthz
# Expect: {"status":"ok"}
```

Sign up for an account at `https://dev.usegrowthforge.com/sign-up`, then approve it for dev
access (see §8) before it can get past the `DevAccessGate`.

---

## 7. Environment variable reference

Full variable list: `.env.example` (repo root) plus `scripts/deploy/dev.env.example` /
`scripts/deploy/prod.env.example`, which show exactly what differs between slots.

| Variable | Dev slot | Prod slot | Notes |
|---|---|---|---|
| `APP_ENV` | `development` | `production` | Activates `requireDevAccess` middleware only in dev |
| `PORT` | `4001` | `4002` | Set via systemd unit, not `.env` |
| `SUPABASE_URL` / `*_KEY` / `DATABASE_URL` | — | — | **Identical** in both slots (shared Supabase project, see §1) |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `growthforge/dev/public` | `growthforge/prod/public` | Different path prefixes in the same Storage bucket — isolates render assets |
| `PRIVATE_OBJECT_DIR` | `growthforge/dev/private` | `growthforge/prod/private` | Same reasoning |
| `STRIPE_SECRET_KEY` | Stripe **test** key | Stripe **live** key | Never test Stripe live-mode on dev |

---

## 8. Approving dev-environment users

Dev access is controlled by the `users.canAccessDev` column, separate from the `role`/`isOwner`
fields that govern the admin console.

1. Sign in as an admin/owner on `dev.usegrowthforge.com/admin/users` (this itself works before
   approval, since the platform owner's account should be pre-approved directly in the DB the
   first time — see below).
2. Open the target user → **Grant dev.usegrowthforge.com access**.

**Bootstrapping the very first approved account** (before any admin UI is reachable), run
directly against the DB:

```sql
update users set can_access_dev = true where email = 'you@example.com';
```

---

## 9. Promotion workflow (dev → prod)

This is intentionally a config/build swap, never a data migration — dev and prod already share
one database, so there's nothing to migrate.

1. **Final testing on `dev.usegrowthforge.com`**: application functionality, auth, video
   rendering, DB operations, storage, performance.
2. **Promote the tested commit to the prod slot**:
   ```bash
   cd /home/ubuntu/prod/app
   git fetch && git checkout <tested-commit-or-tag>
   cp scripts/deploy/prod.env.example .env     # first time only, then fill in real secrets
   bash scripts/deploy/build.sh
   sudo systemctl restart growthforge-prod-api
   ```
3. **Flip the Caddyfile** (`/etc/caddy/Caddyfile`): comment out the pre-launch `usegrowthforge.com`
   Coming-Soon block and the `www` redirect above it, uncomment the `LAUNCHED` block below it
   (proxies to `localhost:4002` + serves the prod build directories), then:
   ```bash
   sudo systemctl reload caddy
   ```
4. **Verify**: domain resolves over HTTPS with a valid cert, `curl https://usegrowthforge.com/api/healthz`
   returns `{"status":"ok"}`, Supabase connection healthy, sign-in works end-to-end, production
   env vars (live Stripe key, etc.) are in place.

To roll a **new dev change** into prod later, repeat step 2–onward with the new commit — dev
keeps moving ahead on `/home/ubuntu/dev/app` independently of whatever is currently live in
`/home/ubuntu/prod/app`.

---

## 10. Rollback

```bash
cd /home/ubuntu/prod/app
git checkout <previous-good-commit-or-tag>
bash scripts/deploy/build.sh
sudo systemctl restart growthforge-prod-api
```

Since dev and prod share one Supabase project, there is no separate prod-only schema rollback
path — schema changes go through Drizzle Kit push against the shared DB and are inherently
already "live" for both slots the moment they're applied. Treat schema changes with extra care;
snapshot the Supabase DB before any destructive migration.

---

## 11. Monitoring

```
GET https://usegrowthforge.com/api/healthz       (prod, post-launch)
GET https://dev.usegrowthforge.com/api/healthz   (dev — open at the network layer, gated by app-level auth for all other routes)
```

Poll the prod endpoint every 60s from an uptime monitor (UptimeRobot, Betterstack, etc.) once
launched. Check systemd status/logs on the box:

```bash
sudo systemctl status growthforge-dev-api growthforge-prod-api
sudo journalctl -u growthforge-prod-api -f
```

---

## 12. Known gotchas (learned deploying to the Nano instance)

These bit us once during the first deploy — captured so future re-deploys (or a second
box) don't hit them again.

1. **The Nano tier (512MB RAM) cannot run `vite build` reliably**, even with the 2GB swap
   file `server-setup.sh` adds and even with `NODE_OPTIONS=--max-old-space-size=1536` (now
   baked into `build.sh`). `pnpm install` and the `api-server` esbuild bundle are fine
   on-box; the `growthforge` Vite/Rollup build is not — it either OOM-kills outright or
   swap-thrashes so hard the *entire instance* becomes unreachable (SSH and HTTP both stop
   responding) until a reboot from the Lightsail console.
   **Do this instead:** build `growthforge` locally (`PORT=9999 BASE_PATH=/ pnpm --filter
   @workspace/growthforge run build`), then copy just `artifacts/growthforge/dist/public`
   to the box (e.g. zip + `scp`) and drop it directly into
   `{dev,prod}/app/artifacts/growthforge/dist/public` — no on-box Vite build needed. Only
   run `build.sh` on-box for the `api-server` portion (or just `pnpm --filter
   @workspace/api-server run build`), which is lightweight (~10-40s).
2. **`caddy`'s system user can't read `/home/ubuntu/**` by default** (`/home/ubuntu` is
   `750 ubuntu:ubuntu`), so every `file_server`/`root` directive under it 403s until you
   `sudo usermod -aG ubuntu caddy && sudo systemctl restart caddy` (reload isn't enough —
   group membership is only re-read on process start).
3. **`TOKEN_ENCRYPTION_KEY` must be a 64-character lowercase hex string** (32 raw bytes,
   hex-encoded) — a base64-encoded key of the same byte length will fail the app's own
   validation at startup (`/api/healthz` returns 503 with a clear message when this is
   wrong). Generate correctly with e.g. `[Convert]::ToString(...) ` → hex, not base64.
4. **`requireDevAccess`'s allowlist paths must NOT include the `/api` prefix.** It's
   mounted as `app.use("/api", requireDevAccess)`, so Express strips `/api` before
   `req.path` reaches the middleware — allowlisting `/api/healthz` silently never matches
   (the real value is `/healthz`), and that route 401s along with everything else. Fixed
   in `middlewares/devAccess.ts`; keep this in mind if more allowlisted routes are added.
5. When a build/copy step is interrupted by an instance hang (see #1), **re-verify file
   completeness before assuming a copy succeeded** — a partial `cp -r` can leave a
   directory that *looks* populated (e.g. it still has the small static files vite copies
   from `public/`) while silently missing the actual bundle (`index.html`, `assets/*.js`).
   `du -sh` / file counts on both sides of a transfer catch this immediately.

---

*Last updated: 2026-08-03.*
