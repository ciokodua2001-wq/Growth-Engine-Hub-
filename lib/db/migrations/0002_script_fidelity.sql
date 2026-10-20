ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "creative_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "script_status" text DEFAULT 'proposed' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "approved_script" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "approved_script_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "dialogue_transcript" jsonb;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "transcript_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "fidelity_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "fidelity_report" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");