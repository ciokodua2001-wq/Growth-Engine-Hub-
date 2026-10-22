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

**No manual migration.** The app performs idempotent `CREATE TABLE IF NOT EXISTS` at startup. Prod currently has **86 tables** vs DEV's **91** — the 5 missing tables (seo/support/owner_* auto-created tables) are created automatically on first start after deploy. Verify prod reaches 91 tables post-start.

---

## 4. Required environment variables (prod `.env` gaps)

| Var | Status | Action |
|---|---|---|
| `STRIPE_SECRET_KEY` | **`stub-not-configured`** | Supply a real test/live key before billing |
| `STRIPE_WEBHOOK_SECRET` | set | Re-generate to match the real key's webhook |
| `META_ACCESS_TOKEN` | **MISSING** | Supply for Meta Ads live calls (app id/secret are set) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **MISSING** | Supply for Google OAuth sign-in (Google Ads client keys are set) |
| `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING` | **MISSING** | Optional (Vertex AI); `GOOGLE_GENAI_API_KEY` (Gemini) is set |

All DB/TLS/auth/storage keys are already present (`DATABASE_URL` → managed prod DB, `BETTER_AUTH_*`, `SUPABASE_*`, `TOKEN_ENCRYPTION_KEY`, object-storage bucket).

---

## 5. Service restart sequence (prod, NOT executed)

1. Build prod from `d924839` (`bash scripts/deploy/build.sh` in the prod slot) or copy the verified DEV artifacts + confirm checksums.
2. `sudo systemctl restart growthforge-prod-api` (never before step 1 completes).
3. Create + start `growthforge-prod-ffmpeg-worker` (mirror the dev worker unit, `APP_ENV=production`, prod `.env`).
4. Confirm `GET http://127.0.0.1:4002/api/version` = `d924839`, `/api/healthz` = ok.

---

## 6. Verification steps

- `GET /api/version` returns `d924839` and `env: production`.
- `GET /api/healthz` returns `{"status":"ok"}`.
- Authenticated smoke tests on 4002: `/api/auth/me`, `/api/projects`, `/api/projects/:id/videos`, `/api/projects/:id/videos/:vid/assemblies`.
- Prod DB reaches 91 tables; row counts unchanged.
- Backup still green (`check-backups.sh`).

---

## 7. Rollback procedure

1. Keep the current prod `dist` (Oct-17 build) as `.rollback`.
2. If the new build fails verification: restore the prior `dist` dir, `systemctl restart growthforge-prod-api`, keep Caddy on `coming-soon`.
3. If Caddy cutover fails: revert `usegrowthforge.com` to `root * /home/ubuntu/coming-soon`.

---

## 8. Explicit launch blockers

1. **Stripe not configured** (`stub-not-configured`) — live/test billing cannot run.
2. **No production FFmpeg worker** — only `dev-worker-1` exists.
3. **Prod app code is stale** (built Oct-17 ≈ `db2516b`) — must be rebuilt from `d924839`.
4. **Production domain serves Coming Soon** — requires Caddy cutover (`usegrowthforge.com` → app).
5. **Meta access token missing** — Meta Ads live calls will fail.
6. **Google OAuth sign-in keys missing** — Google login not fully wired.
7. **Autonomous advertising ACT mode** — NOT enabled; integrations must not be claimed commercially ready until the above are resolved.

---

*No production deployment, schema change, service restart, Stripe activation, paid AI, advertising spend, or infrastructure purchase was performed. DEV-only changes: fingerprint endpoint + deploy to DEV.*
