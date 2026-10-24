ALTER TABLE "users" ADD COLUMN "paystack_access_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paystack_renewal_disabled" boolean DEFAULT false NOT NULL;
