import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * Immutable content integrity log — one row per AI-generated asset.
 * Written at generation time; never updated except for access tracking.
 * SHA-256 hash proves the exact content that was generated and when.
 * isTestAccount = true rows are excluded from legal evidence reports.
 */
export const contentIntegrityLogTable = pgTable("content_integrity_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  contentType: text("content_type").notNull(),
  contentId: text("content_id").notNull(),
  contentHash: text("content_hash").notNull(),
  summary: text("summary"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  firstAccessedAt: timestamp("first_accessed_at", { withTimezone: true }),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  accessCount: integer("access_count").notNull().default(0),
  isTestAccount: boolean("is_test_account").notNull().default(false),
});

export type ContentIntegrityLog = typeof contentIntegrityLogTable.$inferSelect;
export type InsertContentIntegrityLog = typeof contentIntegrityLogTable.$inferInsert;
