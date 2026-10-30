-- Forward-only reconciliation migration for the production database.
-- Evidence: schema drift diff (throwaway copy of growthforge_prod vs growthforge_dev)
-- found exactly TWO missing columns. Verified on a throwaway copy on 2026-10-20:
-- after these two ALTERs, column-level drift = 0.
--
-- The 3 tables present in dev but not prod (_phase3_backup_artifacts_p8,
-- _phase3_backup_business_sources_p8, _phase3_backup_project8) are ad-hoc dev
-- backup artifacts and are NOT part of the schema - do not create them in prod.
--
-- The stripe.* schema is managed separately by stripe-replit-sync runMigrations()
-- at startup and self-heals; no action needed here.

ALTER TABLE "competitors" ADD COLUMN "superseded_at" timestamp with time zone;
ALTER TABLE "personas"     ADD COLUMN "superseded_at" timestamp with time zone;

-- Billing-integrity (global launch): failed-payment grace tracking + video-credit
-- idempotency. Both additive/forward-only.
ALTER TABLE "users" ADD COLUMN "subscription_past_due_since" timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS "video_second_logs_stripe_session_key"
  ON "video_second_logs" ("stripe_session_id");
