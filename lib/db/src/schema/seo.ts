import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const seoStrategiesTable = pgTable("seo_strategies", {
  id:           serial("id").primaryKey(),
  projectId:    integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  status:       text("status").notNull().default("pending"), // "generating" | "complete" | "failed"
  strategy:     jsonb("strategy"),
  errorMessage: text("error_message"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeoStrategy = typeof seoStrategiesTable.$inferSelect;
export type InsertSeoStrategy = typeof seoStrategiesTable.$inferInsert;
