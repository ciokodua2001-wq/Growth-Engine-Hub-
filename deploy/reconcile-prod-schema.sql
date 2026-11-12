-- Forward-only reconciliation migration for the production database.
-- Evidence: schema drift diff (throwaway copy of growthforge_prod vs growthforge_dev)
-- found exactly TWO missing columns. Verified on a throwaway copy on 2026-10-20:
-- after these two ALTERs, column-level drift = 0.
--
-- The 3 tables present in dev but not prod (_phase3_backup_artifacts_p8,
-- _phase3_backup_business_sources_p8, _phase3_backup_project8) are ad-hoc dev
-- backup artifacts and are NOT part of the schema - do not create them in prod.
--
-- STATUS 2026-11-12 (read-only check against growthforge_prod via the prod
-- DATABASE_URL): NONE of these four objects exist in production yet —
-- users.subscription_past_due_since = absent, video_second_logs_stripe_session_key
-- = absent, competitors.superseded_at = absent, personas.superseded_at = absent.
-- This file was therefore PREPARED but never EXECUTED. It is a hard gate before
-- deploying the release branch: `release/global-prelaunch` selects
-- users.subscription_past_due_since, so without this migration every
-- `db.select().from(usersTable)` 500s — which in practice means new sign-ups
-- silently fail to get their application `users` row (the Better Auth
-- databaseHooks provisioning step throws) and plan gating breaks.
-- DEV (growthforge_dev) was brought up to match on 2026-11-12 and sign-up
-- provisioning was re-tested green afterwards.
--
-- Statements are idempotent (IF NOT EXISTS), so re-running is safe. The unique
-- index requires zero duplicate non-null stripe_session_id rows — verify first:
--   select stripe_session_id, count(*) from video_second_logs
--   where stripe_session_id is not null group by 1 having count(*) > 1;
--
-- The stripe.* schema is managed separately by stripe-replit-sync runMigrations()
-- at startup and self-heals; no action needed here.

ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;
ALTER TABLE "personas"     ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;

-- Billing-integrity (global launch): failed-payment grace tracking + video-credit
-- idempotency. Both additive/forward-only.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_past_due_since" timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS "video_second_logs_stripe_session_key"
  ON "video_second_logs" ("stripe_session_id");
