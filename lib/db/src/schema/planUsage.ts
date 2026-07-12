import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

/**
 * Monthly usage tracking for paid-plan projects.
 * One row per (projectId, feature, periodStart) — where periodStart is the
 * first day of the UTC calendar month. Rows are upserted atomically inside a
 * transaction (SELECT ... FOR UPDATE) to prevent double-spending.
 *
 * Trial-plan usage is tracked separately in trialUsageTable (lifetime, not monthly).
 */
export const planUsageTable = pgTable(
  "plan_usage",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    count: integer("count").notNull().default(0),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("plan_usage_project_feature_period_idx").on(
      table.projectId,
      table.feature,
      table.periodStart,
    ),
  ],
);

export type PlanUsage = typeof planUsageTable.$inferSelect;
export type InsertPlanUsage = typeof planUsageTable.$inferInsert;
