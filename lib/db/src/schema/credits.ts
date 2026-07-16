import { pgTable, text, serial, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";

export const platformCreditBanksTable = pgTable("platform_credit_banks", {
  id:                    serial("id").primaryKey(),
  provider:             text("provider").notNull().unique(),
  displayName:          text("display_name").notNull(),
  unit:                 text("unit").notNull().default("credits"),
  balance:              real("balance").notNull().default(0),
  peakBalance:          real("peak_balance").notNull().default(0),
  totalAdded:           real("total_added").notNull().default(0),
  totalCreditsConsumed: real("total_credits_consumed").notNull().default(0),
  totalUsdSpent:        real("total_usd_spent").notNull().default(0),
  totalVideosGenerated: integer("total_videos_generated").notNull().default(0),
  totalMinutesGenerated: real("total_minutes_generated").notNull().default(0),
  billingModel:         text("billing_model").notNull().default("payg"),
  subscriptionPlan:     text("subscription_plan"),
  subscriptionCostUsd:  real("subscription_cost_usd"),
  monthlyCredits:       real("monthly_credits"),
  alertThresholdPct:    integer("alert_threshold_pct").notNull().default(30),
  alertEmail:           text("alert_email"),
  alertEnabled:         boolean("alert_enabled").notNull().default(true),
  lastAlertAt:          timestamp("last_alert_at", { withTimezone: true }),
  notes:                text("notes"),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformCreditTransactionsTable = pgTable("platform_credit_transactions", {
  id:               serial("id").primaryKey(),
  provider:         text("provider").notNull(),
  type:             text("type").notNull(),
  amount:           real("amount").notNull(),
  balanceAfter:     real("balance_after").notNull(),
  description:      text("description").notNull(),
  referenceId:      text("reference_id"),
  purchaseCostUsd:  real("purchase_cost_usd"),
  minutesGenerated: real("minutes_generated"),
  videosCount:      integer("videos_count"),
  projectId:        integer("project_id"),
  userId:           text("user_id"),
  videoId:          text("video_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformCreditBank = typeof platformCreditBanksTable.$inferSelect;
export type PlatformCreditTransaction = typeof platformCreditTransactionsTable.$inferSelect;
