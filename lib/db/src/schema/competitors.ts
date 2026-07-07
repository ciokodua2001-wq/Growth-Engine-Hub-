import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const competitorsTable = pgTable("competitors", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  websiteUrl: text("website_url").notNull(),
  industry: text("industry"),
  description: text("description"),
  strengths: text("strengths"),
  weaknesses: text("weaknesses"),
  marketGaps: text("market_gaps"),
  pricingInsights: text("pricing_insights"),
  messagingInsights: text("messaging_insights"),
  hookStrength: integer("hook_strength"),
  conversionPotential: integer("conversion_potential"),
  differentiationScore: integer("differentiation_score"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompetitorSchema = createInsertSchema(competitorsTable).omit({ id: true, createdAt: true });
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type Competitor = typeof competitorsTable.$inferSelect;
