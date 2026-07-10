import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("draft"),
  budget: numeric("budget", { precision: 10, scale: 2 }),
  spent: numeric("spent", { precision: 10, scale: 2 }),
  impressions: integer("impressions"),
  clicks: integer("clicks"),
  conversions: integer("conversions"),
  roas: numeric("roas", { precision: 10, scale: 2 }),
  ctr: numeric("ctr", { precision: 10, scale: 4 }),
  cpc: numeric("cpc", { precision: 10, scale: 2 }),
  autonomousOptimization: boolean("autonomous_optimization").notNull().default(false),
  source: text("source").notNull().default("manual"),   // 'manual' | 'google_ads' | 'meta' | 'linkedin'
  externalId: text("external_id"),                       // campaign ID from the ad platform
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  url: text("url"),
  thumbnailUrl: text("thumbnail_url"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, createdAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  period: text("period").notNull(),
  status: text("status").notNull().default("pending"),
  summary: text("summary"),
  kpiTrends: text("kpi_trends"),
  recommendations: text("recommendations"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;

export const agentMessagesTable = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  actionType: text("action_type"),
  actionResult: text("action_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentMessageSchema = createInsertSchema(agentMessagesTable).omit({ id: true, createdAt: true });
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentMessage = typeof agentMessagesTable.$inferSelect;
