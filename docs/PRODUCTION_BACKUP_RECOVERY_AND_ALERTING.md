# GrowthForge — Production Backup Recovery & Alerting

Date: 2026-10-22 (UTC) · Backup-maintenance only (no app deploy/schema change)
Follows commit `de5d69b` · Author: automated backup-repair task

---

## 1. Root cause and exact production backup fix

**Root cause:** `backup-prod-db.sh` read `DATABASE_URL` from the prod `.env` and passed it **verbatim** to `psql` (for server-version detection) and `pg_dump`. The URL contains the node-only query param `uselibpqcompat=true`; libpq tools reject it:

```
psql: error: invalid URI query parameter: "uselibpqcompat"
pg_dump: error: invalid URI query parameter: "uselibpqcompat"
```

Consequences: server-major detection returned empty (so it fell back to `pg_dump 16`, which cannot dump PostgreSQL 18.6), and `pg_dump` exited 1 — so the prod backup had been failing since the managed-DB migration.

**Fix (minimum + safety):**
1. Added `DB_URL_LIBPQ=$(printf '%s' "$DB_URL" | sed -E 's/[?&]uselibpqcompat=true(&|$)/\1/; s/[?&]$//')` and used it for both `psql` and `pg_dump`.
2. Added archive validation (`pg_restore --list`) before encrypting, so a corrupt/partial dump is never uploaded as a success.
3. Wrapped the Wasabi `s3 cp` in an explicit pass/fail check (`exit 1` on failure).
4. Restored the executable bit (`chmod +x`) — the file was mode `0644`, so the cron would have also failed with "Permission denied".

Credentials, TLS (`sslmode=require`), GPG AES-256 passphrase, Wasabi destination (`s3://strapli-tech-main/_infra-backups/growthforge-prod/…`), and the `growthforge_prod`-only guard are all preserved. The fixed script is committed at `scripts/backup-prod-db.sh`.

---

## 2. Production dump — SUCCESS

```
[18:16:33Z] Backing up growthforge_prod (prod) -> Wasabi (pg_dump 18)
[18:16:33Z] pg_dump OK (276K)
[18:16:33Z] archive validated (pg_restore --list OK)
[18:16:35Z] Uploaded to s3://strapli-tech-main/_infra-backups/growthforge-prod/2026/10/growthforge_prod-2026-10-22T18-16-32Z.dump.gpg
[18:16:35Z] Backup complete for growthforge_prod
```

---

## 3. Wasabi upload + encryption — VERIFIED

- Object: `growthforge_prod-2026-10-22T18-16-32Z.dump.gpg` = **40,123 bytes**, timestamp 2026-10-22 18:16:35Z.
- Decrypted: **276,734 bytes**, `pg_restore --list` = **617 objects** (valid custom archive).

---

## 4. Isolated production restore drill — SUCCESS

Restored into a temporary database `growthforge_restore_prod_drill` (never over prod/DEV; not connected to any service), then dropped:

- `pg_restore --no-owner --no-privileges` → rc 0.
- **86 tables** restored.
- Representative row counts **match the live prod DB exactly** (prod is pre-launch/empty):

| table | live prod | restored |
|---|---:|---:|
| users | 0 | 0 |
| projects | 0 | 0 |
| commercial_assemblies | 0 | 0 |
| videos | 0 | 0 |

Live prod contains only `_migrations` (53 rows) and `support_knowledge_base` (1 row). No customer data was exported or exposed (only counts were read; the temp DB was dropped).

---

## 5. DEV and production backup schedules

| Job | Schedule (UTC) | Targets | Status |
|---|---|---|---|
| `backup-dev-db.sh` | daily 03:15 | managed `growthforge_dev` → Wasabi | enabled |
| `backup-to-wasabi.sh` | daily 03:30 | infra snapshot → Wasabi | enabled |
| `backup-prod-db.sh` | daily 04:30 | managed `growthforge_prod` → Wasabi | enabled |
| (old) `growthforge-backup.sh` | — | local Postgres | retired (removed) |

---

## 6. Failure-monitoring status

- Both backup scripts exit nonzero on dump/validation/encrypt/upload failure and write `ERROR:` lines to `/home/ubuntu/backup-{dev,prod}.log` (plus cron's `backup-{dev,prod}-cron.log`).
- Added `check-backups.sh` (committed at `scripts/check-backups.sh`): reports the age of the last "Backup complete" for dev + prod and **exits 1 if either is older than 26 h** (detects missed/failed backups). Current output: `OK dev: 0h ago`, `OK prod: 0h ago`.
- **No notification destination exists** (no Slack/Discord/email/webhook; the only `WEBHOOK_SECRET` is a deploy webhook, not alerting).

---

## 7. Are real alerts delivered or only logged?

**Only logged — no real alert is delivered.** There is no authorized Slack/email/monitoring endpoint to send to, and none was created (no paid account). The missing step is wiring `check-backups.sh` (or a cron wrapper) to an approved destination (e.g., a healthchecks.io ping or Slack webhook URL). Until then, failure detection is manual: run `check-backups.sh` or inspect the two log files.

---

## 8. Snapshot / account ownership limitations

- Host instance role: account **`430300055564`** (no Lightsail IAM permissions — `AccessDenied`).
- Console where `growthforge-db` was created: account **`848554269944`**.
- Manual checks required (console, read-only): open **Lightsail → Databases → `growthforge-db`** and note the account ID in the top-right; open **Snapshots & restore** to confirm (a) automated snapshot enabled, (b) retention days, and (c) whether a snapshot can be restored. No IAM/snapshot configuration was changed.

---

## 9. Remaining production recovery risks

1. **No alert delivery** (see §7) — failures are logged but not pushed to anyone.
2. **Lightsail snapshot retention unverified** (console-only).
3. **No point-in-time recovery** (Lightsail managed DB = snapshot + `pg_dump` only).
4. **Restore is dump-based and untested against a populated prod** (prod is currently empty); a future restore with real data should be re-drilled.

---

## 10. Commit hash

Follow-up commit (see final message). Report: `docs/PRODUCTION_BACKUP_RECOVERY_AND_ALERTING.md`. Scripts: `scripts/backup-prod-db.sh`, `scripts/check-backups.sh`.

---

## Verdict

**PRODUCTION BACKUP VERIFIED** — the managed production database was dumped, encrypted, uploaded to Wasabi, retrieved, decrypted, and restored into an isolated database with matching schema (86 tables) and row counts.

*No production deployment, schema/role/record change, service restart, infrastructure purchase, or destructive operation was performed.*
