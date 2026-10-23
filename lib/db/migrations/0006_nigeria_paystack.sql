ALTER TABLE "users" ADD COLUMN "paystack_customer_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paystack_subscription_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paystack_plan_interval" text;--> statement-breakpoint
CREATE TABLE "paystack_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"customer_code" text,
	"plan_code" text,
	"raw_data" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paystack_events_event_id_unique" UNIQUE("event_id")
);
