# GrowthForge — Production Release & Rollback Runbook (Code Freeze)

Status: **PREPARED — do not execute without owner authorization**
Release candidate: **`d924839`** (fingerprint-verified, deployed + smoke-tested on DEV)
Assembly mode: **`FFMPEG_WORKER_MODE=false`** (inline — no new prod worker)

---

## 0. Release candidate identity

- Git commit: `d924839` (`d924839fb45077cacdb986fa8a1d70352055cd73`)
- `GET /api/version` must return that commit and `env: production` after deploy.
- Artifact checksums (verified DEV build):
  - `api-server/dist/index.mjs` = `59201b73d3ea40fea2b250e7ba9f6c79`
  - `api-server/dist/ffmpeg-worker.mjs` = `369170c15721c04a44d660091ca2d6fb`
  - `growthforge/dist/public/index.html` = `450df4e1971e2b202e57c8171e018f46`

---

## 1. Pre-flight (already verified — re-confirm before cutover)

- [x] DEV + prod backups succeed (`check-backups.sh` green).
- [x] DEV + prod restore drills verified (decrypt + restore + row counts).
- [x] Inline assembly proven (41 inline-completed assemblies; same `ffmpegAssembler` as worker).
- [x] FFmpeg present (`/usr/bin/ffmpeg` 6.1.1).

---

## 2. Required prod `.env` injection (secrets from toolbox/dev, never committed)

| Var | Required for |
|---|---|
| `FFMPEG_WORKER_MODE=false` | inline assembly (no worker) |
| `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` | **assembly media upload to Wasabi** (currently MISSING in prod) |
| `STRIPE_SECRET_KEY` (test mode), `STRIPE_WEBHOOK_SECRET` | billing (owner attaches ~2 days) |
| `META_ACCESS_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Meta/Google integrations (toolbox) |
| `BETTER_AUTH_SECRET` (new prod-only) | auth |

---

## 3. Non-destructive schema migration (forward-only)

Apply `deploy/reconcile-prod-schema.sql` to `growthforge_prod` (2 additive `ADD COLUMN`):
- `ALTER TABLE competitors ADD COLUMN superseded_at timestamptz;`
- `ALTER TABLE personas ADD COLUMN superseded_at timestamptz;`

No `DROP`, `TRUNCATE`, or destructive `ALTER`. `stripe.*` self-heals at startup. Do **not** add `claimed_by`/`claimed_at` (worker-only; not needed for inline mode).

---

## 4. Release steps (execute in order, only after authorization)

1. Apply `deploy/reconcile-prod-schema.sql` to prod.
2. Build prod from `d924839` (or copy the verified DEV artifacts + re-check checksums).
3. Inject prod `.env` (section 2).
4. `sudo systemctl restart growthforge-prod-api` (no worker needed).
5. Verify:
   - `GET /api/version` → `d924839`, `env: production`
   - `GET /api/healthz` → `{"status":"ok"}`
   - authenticated smoke: `/api/auth/me`, `/api/projects`, `/api/projects/:id/videos`, `/api/projects/:id/videos/:vid/assemblies`
   - one end-to-end assembly completes with a real `video_url`
6. Caddy cutover: `usegrowthforge.com` → prod app (replace `coming-soon`), `/api/*` → `localhost:4002`.
7. Keep `dev.usegrowthforge.com` and `dev-worker-1` unchanged.

---

## 5. Rollback

1. Keep the current prod `dist` (Oct-17) as `.rollback` before step 2.
2. On failure: restore prior `dist`, `systemctl restart growthforge-prod-api`, leave `coming-soon` in Caddy.
3. The 2 `ADD COLUMN` migrations are additive — rollback is optional; if needed, `DROP COLUMN` is non-destructive to data (only the new columns).

---

## 6. Deferred (post-launch, not now)

- Dedicated `growthforge-prod-ffmpeg-worker` + `claimed_by`/`claimed_at` migration (only if encode concurrency grows).
- Live Stripe key (test mode until real launch).
- Google OAuth end-to-end test.

*No production deployment, schema change, restart, or routing change has been performed. This runbook is documentation only.*
