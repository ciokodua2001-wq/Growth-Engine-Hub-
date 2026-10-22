# GrowthForge — DEV Database Backup & Restore Verification

Date: 2026-10-22 (UTC) · DEV only · Follows commit `b45ee50`
Author: automated recovery-hardening task

---

## 1. Root cause of the backup gap

The DEV backup cron (`/usr/local/bin/growthforge-backup.sh`, root cron `0 3 * * *`) ran `sudo -u postgres pg_dump -Fc -d growthforge_dev`, which dumps the **local** PostgreSQL instance over the Unix socket — not the managed Lightsail database. When DEV was migrated to managed PostgreSQL, this script was never repointed. As a result the "dev backup" was silently backing up the obsolete local Postgres while the **managed `growthforge_dev` had no backup at all**.

Secondary: `backup-to-wasabi.sh` is a generic "Supabase" script (reused from another project) and is not GrowthForge-specific.

---

## 2. Exact script and scheduling changes

**Created `/home/ubuntu/backup-dev-db.sh`** (mirrors the correct `backup-prod-db.sh` pattern):
- Reads `DATABASE_URL` from the dev `.env` (least-privilege `growthforge_app_dev` role).
- **Strips the node-only `uselibpqcompat=true`** param before passing the URL to `psql`/`pg_dump` (libpq rejects it).
- Detects the server major (18) and uses `/usr/lib/postgresql/18/bin/pg_dump`.
- `pg_dump --no-owner --no-privileges -Fc`, then **validates** the archive (`pg_restore --list`) before encrypting.
- GPG AES-256 (passphrase from `/home/ubuntu/.backup-gpg-passphrase`), uploads to `s3://strapli-tech-main/_infra-backups/growthforge-dev/YYYY/MM/…`.
- **30-day rotation** (deletes dev backups older than 30 days).
- **Nonzero exit** on any dump/validation/encrypt/upload failure (no false-success artifact).

**Scheduling:**
- Added ubuntu cron: `15 3 * * * /home/ubuntu/backup-dev-db.sh >> /home/ubuntu/backup-dev-cron.log 2>&1`.
- **Retired** the stale root cron `growthforge-backup.sh` (root crontab is now empty).

The script is also committed to the repo at `scripts/backup-dev-db.sh`.

---

## 3. Managed database backup — SUCCESS

```
[18:09:31Z] Backing up growthforge_dev (managed, server 18) -> Wasabi
[18:09:32Z] pg_dump OK (10M)
[18:09:32Z] archive validated (pg_restore --list OK)
[18:09:33Z] Encrypted archive: 9.8M
[18:09:36Z] Uploaded to s3://strapli-tech-main/_infra-backups/growthforge-dev/2026/10/growthforge_dev-2026-10-22T18-09-31Z.dump.gpg
[18:09:36Z] Backup complete for growthforge_dev
```

Two artifacts produced: `…T18-09-31Z` and `…T18-11-02Z`.

---

## 4. Wasabi upload + encryption — VERIFIED

- Object present in Wasabi: `growthforge_dev-2026-10-22T18-09-31Z.dump.gpg` = **10,207,000 bytes**.
- Decryption confirmed `AES256.CFB` with 1 passphrase → 10,426,335-byte custom-format archive.
- `pg_restore --list` → **641 objects** (schema + data), valid archive.

---

## 5. Restore drill — SUCCESS (non-destructive)

Performed against an isolated temp database `growthforge_restore_drill` (never over the live DEV/prod DB):

1. Download from Wasabi → 10,207,000 bytes.
2. GPG decrypt → 10,426,335 bytes.
3. `pg_restore --no-owner --no-privileges -d growthforge_restore_drill` → **rc 0**.
4. Validated row counts vs source:

| table | source | restored |
|---|---:|---:|
| users | 8 | 8 |
| projects | 13 | 13 |
| commercial_assemblies | 50 | 50 |
| videos | 20 | 20 |
| total tables (public/stripe/drizzle) | 91 | 91 |

5. Temp database dropped after validation.

**Completion criteria met:** the managed-DEV backup was decrypted and restored into an isolated database, with core tables + representative row counts matching.

---

## 6. Snapshot / AWS account ownership findings

- API host instance role: account **`430300055564`** (`AmazonLightsailInstanceRole`, instance `i-01422a6085caf4f18`).
- Console session where `growthforge-db` was created: account **`848554269944`** (Strapli Technologies Inc.).
- The instance role has **no Lightsail IAM permissions** (`lightsail:GetInstances` and `lightsail:GetRelationalDatabase` both `AccessDenied`), so the DB snapshot/retention state cannot be read from the host CLI.
- The app connects to the managed DB successfully (private endpoint + SSL), so the instance and DB share reachability, but the **exact owning account could not be confirmed programmatically**.

**What to check in the console (read-only):** sign in and open **Lightsail → Databases → `growthforge-db`**. The account ID shown in the top-right is the account that owns the DB and its snapshots. Use **that** account's console (**Snapshots & restore** tab) to view retention and restore a snapshot. No IAM changes were made.

---

## 7. Remaining recovery risks

1. **No failure alerting** — no Slack/Discord/email/webhook notification channel exists. Failures only appear in `/home/ubuntu/backup-dev.log` and `backup-dev-cron.log`. Recommend a healthchecks.io ping or a Slack/Discord webhook on failure (DEV-safe, no infra).
2. **Prod backup has a latent bug** — `backup-prod-db.sh` does not strip `uselibpqcompat`, so it would fail against the managed prod DB (libpq rejects the param). **Not modified** per "do not touch production"; needs explicit approval to fix (one-line change).
3. **Lightsail snapshot retention unverified** (console-only; see §6).
4. **No point-in-time recovery** (Lightsail managed DB = snapshot + `pg_dump` only).
5. **Restore is untested against prod** (by design; only DEV was drilled).

---

## 8. Relevant test results

| Test | Result |
|---|---|
| `bash -n backup-dev-db.sh` | PASS |
| managed-DEV `pg_dump` (pg 18) | PASS (10 MB) |
| archive validation (`pg_restore --list`) | PASS (641 objects) |
| GPG AES-256 encryption | PASS |
| Wasabi upload + object exists | PASS (10,207,000 bytes) |
| Wasabi download + decrypt | PASS |
| restore into isolated temp DB | PASS |
| row-count validation (8/13/50/20, 91 tables) | PASS |
| temp DB cleanup | PASS |
| rotation (no old objects to delete) | PASS (no-op) |
| DEV services healthy + data intact after drill | PASS |

---

## 9. Commit hash

Follow-up commit (see final message). Report: `docs/DEV_DATABASE_BACKUP_AND_RESTORE_VERIFICATION.md`. Script: `scripts/backup-dev-db.sh`.

*No production changes, no infrastructure purchases, no destructive DB changes, no paid AI calls.*
