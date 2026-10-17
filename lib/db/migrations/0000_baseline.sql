CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"website_url" text,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"industry" text,
	"logo_url" text,
	"autonomous_mode" boolean DEFAULT false NOT NULL,
	"branding_company_name" text,
	"branding_accent_color" text,
	"plan" text DEFAULT 'starter' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"detected_locale" text,
	"source_type" text DEFAULT 'website' NOT NULL,
	"source_url" text,
	"operating_model" text DEFAULT 'business' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"business_summary" text,
	"industry" text,
	"products" text,
	"services" text,
	"unique_value_proposition" text,
	"target_customers" text,
	"ideal_customer_profile" text,
	"customer_pain_points" text,
	"brand_voice" text,
	"brand_positioning" text,
	"customer_benefits" text,
	"purchase_triggers" text,
	"market_opportunities" text,
	"growth_opportunities" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketing_strategy" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"positioning_statement" text,
	"messaging_framework" text,
	"brand_voice_guide" text,
	"seo_strategy" text,
	"campaign_strategy" text,
	"lead_generation_strategy" text,
	"funnel_recommendations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"age" text,
	"gender" text,
	"occupation" text,
	"income" text,
	"location" text,
	"interests" text,
	"motivations" text,
	"objections" text,
	"buying_triggers" text,
	"buying_journey" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"market_gaps" text,
	"positioning_opportunities" text,
	"winning_hooks" text,
	"winning_ctas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_report_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"website_url" text NOT NULL,
	"industry" text,
	"description" text,
	"strengths" text,
	"weaknesses" text,
	"market_gaps" text,
	"pricing_insights" text,
	"messaging_insights" text,
	"hook_strength" integer,
	"conversion_potential" integer,
	"differentiation_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"platform" text NOT NULL,
	"headline" text NOT NULL,
	"description" text,
	"cta" text,
	"image_url" text,
	"type" text DEFAULT 'image' NOT NULL,
	"hook_strength" integer,
	"conversion_potential" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"meta_description" text,
	"seo_keywords" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"hook_strength" integer,
	"conversion_potential" integer,
	"engagement_potential" integer,
	"viral_potential" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"preview_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"open_rate" text,
	"click_rate" text,
	"sent_at" timestamp with time zone,
	"recipient_count" integer,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"platform" text NOT NULL,
	"caption" text NOT NULL,
	"hashtags" text,
	"cta" text,
	"image_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_post_id" text,
	"publishing_at" timestamp with time zone,
	"stats_likes" integer,
	"stats_comments" integer,
	"stats_reach" integer,
	"stats_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"script" text,
	"storyboard" text,
	"voiceover" text,
	"cinematic_plan" text,
	"thumbnail_url" text,
	"video_url" text,
	"duration" integer,
	"hook_strength" integer,
	"engagement_potential" integer,
	"viral_potential" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"render_status" text DEFAULT 'idle' NOT NULL,
	"render_resolution" text,
	"render_job_id" text,
	"render_started_at" timestamp with time zone,
	"render_completed_at" timestamp with time zone,
	"render_error" text,
	"voiceover_url" text,
	"aspect_ratio" text DEFAULT '16:9' NOT NULL,
	"captions_enabled" boolean DEFAULT false NOT NULL,
	"narration_voice_style" text
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"action_type" text,
	"action_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"thumbnail_url" text,
	"file_size" integer,
	"mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"budget" numeric(10, 2),
	"spent" numeric(10, 2),
	"impressions" integer,
	"clicks" integer,
	"conversions" integer,
	"roas" numeric(10, 2),
	"ctr" numeric(10, 4),
	"cpc" numeric(10, 2),
	"autonomous_optimization" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text,
	"kpi_trends" text,
	"recommendations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"can_access_dev" boolean DEFAULT false NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"is_test_account" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan" text DEFAULT 'trial' NOT NULL,
	"subscription_status" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"admin_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "trial_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"feature" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"feature" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"plan_name" text,
	"consumed_usd" real,
	"ceiling_usd" real,
	"consumed_pct" real,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" integer,
	"feature" text NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"billing_period_start" timestamp with time zone NOT NULL,
	"is_video_render" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_integrity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" integer,
	"content_type" text NOT NULL,
	"content_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"summary" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_accessed_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"is_test_account" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_credit_banks" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"unit" text DEFAULT 'credits' NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
	"peak_balance" real DEFAULT 0 NOT NULL,
	"total_added" real DEFAULT 0 NOT NULL,
	"total_credits_consumed" real DEFAULT 0 NOT NULL,
	"total_usd_spent" real DEFAULT 0 NOT NULL,
	"total_videos_generated" integer DEFAULT 0 NOT NULL,
	"total_minutes_generated" real DEFAULT 0 NOT NULL,
	"billing_model" text DEFAULT 'payg' NOT NULL,
	"subscription_plan" text,
	"subscription_cost_usd" real,
	"monthly_credits" real,
	"alert_threshold_pct" integer DEFAULT 30 NOT NULL,
	"alert_email" text,
	"alert_enabled" boolean DEFAULT true NOT NULL,
	"last_alert_at" timestamp with time zone,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_credit_banks_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "platform_credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"amount" real NOT NULL,
	"balance_after" real NOT NULL,
	"description" text NOT NULL,
	"reference_id" text,
	"purchase_cost_usd" real,
	"minutes_generated" real,
	"videos_count" integer,
	"project_id" integer,
	"user_id" text,
	"video_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_ad_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"customer_id" text,
	"account_name" text,
	"account_email" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text NOT NULL,
	"page_access_token" text NOT NULL,
	"instagram_account_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_page_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"pages_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"strategy" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_strategies_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "seo_blog_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"keyword" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"word_count" integer DEFAULT 0,
	"status" text DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_comparison_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"slug" text NOT NULL,
	"competitor" text NOT NULL,
	"title" text NOT NULL,
	"content_html" text NOT NULL,
	"meta_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_comparison_pages_project_slug_uniq" UNIQUE("project_id","slug")
);
--> statement-breakpoint
CREATE TABLE "seo_meta_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"pages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_meta_tags_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "seo_schema_markup" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"schemas" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_schema_markup_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "seo_sitemaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"xml" text NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_sitemaps_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "seo_watchdog" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"week_of" date NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"actions" jsonb NOT NULL,
	"progress_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_watchdog_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invite_token" text,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kling_scene_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"scene_index" integer NOT NULL,
	"scene_name" text,
	"scene_type" text,
	"environment" text,
	"camera_movement" text,
	"lighting" text,
	"mood" text,
	"composition" text,
	"motion" text,
	"brand_style" text,
	"marketing_objective" text,
	"narration_line" text,
	"audio_mood" text,
	"prompt" text NOT NULL,
	"kling_task_id" text,
	"external_task_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text DEFAULT 'kling-v2-6' NOT NULL,
	"aspect_ratio" text DEFAULT '16:9' NOT NULL,
	"video_url" text,
	"duration_sec" integer,
	"error_message" text,
	"provider" text DEFAULT 'kling' NOT NULL,
	"new_scene_cut" boolean DEFAULT true NOT NULL,
	"source_frame_url" text,
	"prompt_hash" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_assemblies" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"output_format" text DEFAULT 'landscape' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"video_url" text,
	"duration_sec" numeric(8, 2),
	"file_size_bytes" bigint,
	"error_message" text,
	"options" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_second_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"video_id" integer,
	"project_id" integer,
	"type" text NOT NULL,
	"seconds_changed" integer NOT NULL,
	"from_monthly" integer DEFAULT 0 NOT NULL,
	"from_purchased" integer DEFAULT 0 NOT NULL,
	"new_monthly_balance" integer DEFAULT 0 NOT NULL,
	"new_purchased_balance" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"stripe_session_id" text,
	"amount_paid_usd" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"monthly_video_seconds" integer DEFAULT 0 NOT NULL,
	"monthly_seconds_used" integer DEFAULT 0 NOT NULL,
	"purchased_video_seconds" integer DEFAULT 0 NOT NULL,
	"total_purchased_seconds" integer DEFAULT 0 NOT NULL,
	"total_rendered_seconds" integer DEFAULT 0 NOT NULL,
	"last_reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "owner_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"target_type" text DEFAULT 'external' NOT NULL,
	"segment_id" integer,
	"filter_json" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"recipient_count" integer,
	"open_rate" text,
	"click_rate" text,
	"bounce_rate" text,
	"opens_count" integer DEFAULT 0 NOT NULL,
	"clicks_count" integer DEFAULT 0 NOT NULL,
	"bounces_count" integer DEFAULT 0 NOT NULL,
	"unsubscribe_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"unsubscribed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_contacts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "owner_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filter_json" jsonb,
	"segment_type" text DEFAULT 'external' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_suppression_list" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT 'unsubscribed' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ai_response" text,
	"admin_reply" text,
	"admin_replied_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_acl_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_name" text NOT NULL,
	"object_name" text NOT NULL,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"acl_rules" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"source_value" text,
	"display_label" text,
	"authorization_status" text DEFAULT 'none' NOT NULL,
	"provider_account_id" text,
	"retrieval_method" text,
	"retrieved_at" timestamp with time zone,
	"content_hash" text,
	"declared_content" text,
	"retrieved_content" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_sources" (
	"analysis_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"snapshot_content" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_sources_analysis_id_source_id_pk" PRIMARY KEY("analysis_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_analysis" ADD CONSTRAINT "business_analysis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_strategy" ADD CONSTRAINT "marketing_strategy_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_report" ADD CONSTRAINT "competitor_report_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_usage" ADD CONSTRAINT "trial_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_usage" ADD CONSTRAINT "plan_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_usage_events" ADD CONSTRAINT "subscription_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_usage_events" ADD CONSTRAINT "subscription_usage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_integrity_log" ADD CONSTRAINT "content_integrity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_integrity_log" ADD CONSTRAINT "content_integrity_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_ad_accounts" ADD CONSTRAINT "connected_ad_accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_page_sessions" ADD CONSTRAINT "meta_page_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_strategies" ADD CONSTRAINT "seo_strategies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_blog_posts" ADD CONSTRAINT "seo_blog_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_comparison_pages" ADD CONSTRAINT "seo_comparison_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_meta_tags" ADD CONSTRAINT "seo_meta_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_schema_markup" ADD CONSTRAINT "seo_schema_markup_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_sitemaps" ADD CONSTRAINT "seo_sitemaps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_watchdog" ADD CONSTRAINT "seo_watchdog_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kling_scene_jobs" ADD CONSTRAINT "kling_scene_jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_assemblies" ADD CONSTRAINT "commercial_assemblies_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_wallets" ADD CONSTRAINT "video_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_sources" ADD CONSTRAINT "business_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sources" ADD CONSTRAINT "analysis_sources_analysis_id_business_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."business_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sources" ADD CONSTRAINT "analysis_sources_source_id_business_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."business_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_usage_project_feature_idx" ON "trial_usage" USING btree ("project_id","feature");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_usage_project_feature_period_idx" ON "plan_usage" USING btree ("project_id","feature","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_ad_accounts_project_provider_idx" ON "connected_ad_accounts" USING btree ("project_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_connections_project_idx" ON "meta_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "meta_page_sessions_expires_idx" ON "meta_page_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "object_acl_policies_bucket_object_uniq" ON "object_acl_policies" USING btree ("bucket_name","object_name");--> statement-breakpoint
CREATE INDEX "business_sources_project_id_idx" ON "business_sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "analysis_sources_source_id_idx" ON "analysis_sources" USING btree ("source_id");