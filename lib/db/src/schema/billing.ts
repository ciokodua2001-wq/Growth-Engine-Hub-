import { pgTable, text, serial, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * Timestamped log of every AI-costing action taken by any user (trial or paid).
 * Used for refund eligibility calculation, velocity detection, and chargeback rebuttal reports.
 * The costUsd field stores internal cost weights — never exposed to clients.
 */
export const subscriptionUsageEventsTable = pgTable("subscription_usage_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  feature: text("feature").notNull(),
  amount: integer("amount").notNull().default(1),
  costUsd: real("cost_usd").notNull().default(0),
  billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }).notNull(),
  isVideoRender: boolean("is_video_render").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionUsageEvent = typeof subscriptionUsageEventsTable.$inferSelect;
export type InsertSubscriptionUsageEvent = typeof subscriptionUsageEventsTable.$inferInsert;

/**
 * Admin alert notifications — threshold crossings, video renders, chargeback flags.
 * Admins see these in the dashboard and can dismiss them.
 */
export const adminAlertsTable = pgTable("admin_alerts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // 'threshold_crossed' | 'video_rendered' | 'chargeback_flagged'
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  userEmail: text("user_email"),
  planName: text("plan_name"),
  consumedUsd: real("consumed_usd"),
  ceilingUsd: real("ceiling_usd"),
  consumedPct: real("consumed_pct"),
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminAlert = typeof adminAlertsTable.$inferSelect;
export type InsertAdminAlert = typeof adminAlertsTable.$inferInsert;
