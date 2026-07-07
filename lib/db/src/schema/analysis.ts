import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const businessAnalysisTable = pgTable("business_analysis", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  businessSummary: text("business_summary"),
  industry: text("industry"),
  products: text("products"),
  services: text("services"),
  uniqueValueProposition: text("unique_value_proposition"),
  targetCustomers: text("target_customers"),
  idealCustomerProfile: text("ideal_customer_profile"),
  customerPainPoints: text("customer_pain_points"),
  brandVoice: text("brand_voice"),
  brandPositioning: text("brand_positioning"),
  customerBenefits: text("customer_benefits"),
  purchaseTriggers: text("purchase_triggers"),
  marketOpportunities: text("market_opportunities"),
  growthOpportunities: text("growth_opportunities"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBusinessAnalysisSchema = createInsertSchema(businessAnalysisTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBusinessAnalysis = z.infer<typeof insertBusinessAnalysisSchema>;
export type BusinessAnalysis = typeof businessAnalysisTable.$inferSelect;

export const personasTable = pgTable("personas", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: text("age"),
  gender: text("gender"),
  occupation: text("occupation"),
  income: text("income"),
  location: text("location"),
  interests: text("interests"),
  motivations: text("motivations"),
  objections: text("objections"),
  buyingTriggers: text("buying_triggers"),
  buyingJourney: text("buying_journey"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPersonaSchema = createInsertSchema(personasTable).omit({ id: true, createdAt: true });
export type InsertPersona = z.infer<typeof insertPersonaSchema>;
export type Persona = typeof personasTable.$inferSelect;

export const marketingStrategyTable = pgTable("marketing_strategy", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  positioningStatement: text("positioning_statement"),
  messagingFramework: text("messaging_framework"),
  brandVoiceGuide: text("brand_voice_guide"),
  seoStrategy: text("seo_strategy"),
  campaignStrategy: text("campaign_strategy"),
  leadGenerationStrategy: text("lead_generation_strategy"),
  funnelRecommendations: text("funnel_recommendations"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMarketingStrategySchema = createInsertSchema(marketingStrategyTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketingStrategy = z.infer<typeof insertMarketingStrategySchema>;
export type MarketingStrategy = typeof marketingStrategyTable.$inferSelect;
