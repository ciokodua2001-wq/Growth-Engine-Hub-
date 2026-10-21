CREATE TABLE "ad_platform_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"platform" text NOT NULL,
	"customer_id" text,
	"campaign_id" text,
	"action_type" text NOT NULL,
	"before_state" text,
	"after_state" text,
	"status" text DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_platform_actions" ADD CONSTRAINT "ad_platform_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_platform_actions_project_created_idx" ON "ad_platform_actions" USING btree ("project_id","created_at");