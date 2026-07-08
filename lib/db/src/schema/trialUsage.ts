import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const trialUsageTable = pgTable(
  "trial_usage",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    count: integer("count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("trial_usage_project_feature_idx").on(table.projectId, table.feature)],
);

export type TrialUsage = typeof trialUsageTable.$inferSelect;
export type InsertTrialUsage = typeof trialUsageTable.$inferInsert;
