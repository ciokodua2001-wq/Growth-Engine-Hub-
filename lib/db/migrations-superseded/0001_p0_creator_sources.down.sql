-- P0 rollback: reverse the schema delta in 0001_p0_creator_sources.sql.
--
-- SAFETY: `ALTER COLUMN website_url SET NOT NULL` will FAIL if any website-less
-- projects exist at rollback time. If they do, backfill a sentinel value (or
-- keep the column nullable) before running this rollback.

DROP TABLE IF EXISTS "analysis_sources";
DROP TABLE IF EXISTS "creator_profiles";
DROP TABLE IF EXISTS "business_sources";

ALTER TABLE "business_analysis" DROP COLUMN IF EXISTS "edited_at";

ALTER TABLE "projects" DROP COLUMN IF EXISTS "operating_model";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "source_url";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "source_type";
ALTER TABLE "projects" ALTER COLUMN "website_url" SET NOT NULL;
