# GrowthForge — Production Release Manifest

Date: 2026-10-22 (UTC) · Prepared by automated release-control task
Status: **PREPARED — production deployment NOT executed**

---

## 1. Git commit to release

**`d924839`** (`d924839fb45077cacdb986fa8a1d70352055cd73`) — "Add build-time commit fingerprint and /version endpoint", on top of `0c8d16b`.

DEV is verified running this commit via `GET /api/version` → `{"commit":"d924839fb45077cacdb986fa8a1d70352055cd73",...}`.

---

## 2. Build artifact checksums (verified DEV build)

| Artifact | md5 |
|---|---|
| `api-server/dist/index.mjs` | `59201b73d3ea40fea2b250e7ba9f6c79` |
| `api-server/dist/ffmpeg-worker.mjs` | `369170c15721c04a44d660091ca2d6fb` |
| `api-server/dist/build-info.json` | commit `d924839`, buildTime `2026-10-22T19:12:16Z` |
| `growthforge/dist/public/index.html` | `450df4e1971e2b202e57c8171e018f46` |

---

## 3. Required migrations

**Forward-only reconciliation migration required** (`deploy/reconcile-prod-schema.sql`, commit `a98b921`). Verified on a throwaway prod copy: column drift = 0 after these two ALTERs:

- `ALTER TABLE competitors ADD COLUMN superseded_at timestamptz;`
- `ALTER TABLE personas ADD COLUMN superseded_at timestamptz;`

Notes:
- The 3 `_phase3_backup_*` tables present in dev but not prod are **ad-hoc dev backups, not schema** — do not create them in prod.
- `stripe.*` self-heals via `stripe-replit-sync runMigrations()` at startup (no action).
- Drizzle migrations live in `lib/db/migrations/` (`0000_baseline` … `0005_numerous_fenris`); reconcile any additional drift via `pnpm --filter db push` against prod after the ALTERs.

---

## 4. Required environment variables (prod `.env`)

| Var | Status | Action |
|---|---|---|
| `STRIPE_SECRET_KEY` | `stub-not-configured` | **Owner attaching in ~2 days**; use TEST mode for the controlled beta, live key only at real launch |
| `STRIPE_WEBHOOK_SECRET` | set (managed) | `stripe-replit-sync` supplies its own signing secret; confirm webhook `https://usegrowthforge.com/api/stripe/webhook` |
| `META_ACCESS_TOKEN` | **in project toolbox** (not missing) | Inject at release |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **in project toolbox + dev `.env`** (verified set) | Inject at release; OAuth app must have the authorized prod redirect URI |
| `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING` | optional | Vertex AI only; `GOOGLE_GENAI_API_KEY` (Gemini) is already set |
| `OBJECT_STORAGE_ENDPOINT` / `OBJECT_STORAGE_REGION` / `OBJECT_STORAGE_ACCESS_KEY_ID` / `OBJECT_STORAGE_SECRET_ACCESS_KEY` | **MISSING in prod `.env`** | Inject from toolbox/dev (required for assembly media upload to Wasabi) |

All DB/TLS/auth/storage keys already present (`DATABASE_URL` → managed prod DB, `BETTER_AUTH_*`, `SUPABASE_*`, `TOKEN_ENCRYPTION_KEY`). Generate a **new prod-only `BETTER_AUTH_SECRET`** (never reuse dev).

---

## 5. Service restart sequence (prod, NOT executed)

1. Apply `deploy/reconcile-prod-schema.sql` to prod (2 ALTERs).
2. Build prod from `d924839` (or copy the verified DEV artifacts + confirm checksums).
3. Inject prod `.env` secrets (toolbox Meta/Google keys, Stripe test key when attached, new `BETTER_AUTH_SECRET`).
4. `sudo systemctl restart growthforge-prod-api`.
5. Create + start `growthforge-prod-ffmpeg-worker` (mirror dev worker unit, `APP_ENV=production`, prod `.env`).
6. Confirm `GET http://127.0.0.1:4002/api/version` = `d924839`, `/api/healthz` = ok.

---

## 6. Verification steps

- `GET /api/version` → `d924839`, `env: production`.
- `GET /api/healthz` → `{"status":"ok"}`.
- Authenticated smoke tests on 4002: `/api/auth/me`, `/api/projects`, `/api/projects/:id/videos`, `/api/projects/:id/videos/:vid/assemblies`.
- Column drift = 0 after reconcile; row counts unchanged.
- Backup still green (`check-backups.sh`).

---

## 7. Rollback procedure

1. Keep the current prod `dist` as `.rollback`.
2. New build fails verification → restore prior `dist`, restart `growthforge-prod-api`, keep Caddy on `coming-soon`.
3. Caddy cutover fails → revert `usegrowthforge.com` to `root * /home/ubuntu/coming-soon`.

---

## 8. Explicit launch blockers

1. **Stripe not yet attached** — owner providing in ~2 days (test mode for beta).
2. **No production FFmpeg worker** — only `dev-worker-1` exists.
3. **Prod app code is stale** (built Oct-17 ≈ `db2516b`) — must be rebuilt from `d924839`.
4. **Production domain serves Coming Soon** — requires Caddy cutover.
5. **Autonomous advertising ACT mode** — NOT enabled; must not be claimed ready until Stripe + integrations are live.

(Meta/Google keys are **not** blockers — they are in the project toolbox and inject at release.)

---

## 9. Notes / corrections from owner

- `META_ACCESS_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` are in the **project toolbox** (not missing). `GOOGLE_CLIENT_ID`/`SECRET` verified present in dev `.env`.
- Stripe key attach expected in ~2 days.
- A second prod slot exists: `/home/ubuntu/prod/app-new` is a **detached git checkout at `389fe73`** (behind `main`) with the authoritative `PRODUCTION_PROMOTION_PLAN.md` + `PRELAUNCH_ACCEPTANCE.md`. The active prod (`/home/ubuntu/prod/app`) is a non-git artifact dir. Release should reconcile which slot is canonical before cutover.

---

*No production deployment, schema change, service restart, Stripe activation, paid AI, advertising spend, or infrastructure purchase was performed. DEV-only: fingerprint endpoint + deploy to DEV.*
