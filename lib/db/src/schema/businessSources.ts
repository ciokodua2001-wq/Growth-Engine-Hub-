import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/**
 * Normalized, one-to-many ledger of every source of business information a
 * project has ever had. A Nigerian entrepreneur can start with Instagram,
 * later connect Facebook, and eventually add a website - all on the same
 * project, without creating a new GrowthForge project.
 *
 * Provenance is stored across four distinct axes (never collapsed into a
 * single boolean):
 *   - authorizationStatus: OAuth authorization to access the account
 *   - declaredContent:      what the owner typed (user-declared)
 *   - retrievedContent:     raw content actually fetched, with retrievalMethod
 *                           + retrievedAt + contentHash (retrieved)
 *   - (inferred)            the AI output lives in business_analysis, linked
 *                           back to this source via analysis_sources
 */
export const businessSourcesTable = pgTable(
  "business_sources",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    sourceValue: text("source_value"),
    displayLabel: text("display_label"),
    authorizationStatus: text("authorization_status").notNull().default("none"),
    providerAccountId: text("provider_account_id"),
    retrievalMethod: text("retrieval_method"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    declaredContent: text("declared_content"),
    retrievedContent: text("retrieved_content"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("business_sources_project_id_idx").on(t.projectId)],
);

export const insertBusinessSourceSchema = createInsertSchema(businessSourcesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBusinessSource = z.infer<typeof insertBusinessSourceSchema>;
export type BusinessSource = typeof businessSourcesTable.$inferSelect;
