-- P0: social-first + creator/hybrid support (schema delta)
--
-- BASELINE NOTE: the live schema was originally created via `drizzle-kit push`
-- (no migration history). Before applying this to production, generate a
-- baseline migration from a restored/pulled copy of the live schema and mark it
-- applied, then apply this delta. Do NOT apply to production without review.

ALTER TABLE "projects" ALTER COLUMN "website_url" DROP NOT NULL;
ALTER TABLE "projects" ADD COLUMN "source_type" text NOT NULL DEFAULT 'website';
ALTER TABLE "projects" ADD COLUMN "source_url" text;
ALTER TABLE "projects" ADD COLUMN "operating_model" text NOT NULL DEFAULT 'business';

ALTER TABLE "business_analysis" ADD COLUMN "edited_at" timestamp with time zone;

CREATE TABLE "business_sources" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "source_type" text NOT NULL,
  "source_url" text,
  "source_value" text,
  "display_label" text,
  "authorization_status" text NOT NULL DEFAULT 'none',
  "provider_account_id" text,
  "retrieval_method" text,
  "retrieved_at" timestamp with time zone,
  "content_hash" text,
  "declared_content" text,
  "retrieved_content" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "business_sources_project_id_idx" ON "business_sources" ("project_id");

CREATE TABLE "creator_profiles" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL UNIQUE REFERENCES "projects"("id") ON DELETE CASCADE,
  "creator_name" text,
  "channel_name" text,
  "primary_platform" text,
  "additional_platforms" text[],
  "content_niche" text,
  "audience_description" text,
  "audience_geography" text,
  "content_languages" text[],
  "content_formats" text[],
  "content_themes" text[],
  "brand_tone" text,
  "current_goals" text,
  "monetization_methods" text[],
  "self_reported_stats" jsonb,
  "media_kit" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "analysis_sources" (
  "analysis_id" integer NOT NULL REFERENCES "business_analysis"("id") ON DELETE CASCADE,
  "source_id" integer NOT NULL REFERENCES "business_sources"("id") ON DELETE CASCADE,
  "snapshot_content" text NOT NULL,
  "snapshot_hash" text NOT NULL,
  "snapshot_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("analysis_id", "source_id")
);
CREATE INDEX "analysis_sources_source_id_idx" ON "analysis_sources" ("source_id");
