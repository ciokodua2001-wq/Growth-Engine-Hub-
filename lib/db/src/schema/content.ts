import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const contentTable = pgTable("content", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  metaDescription: text("meta_description"),
  seoKeywords: text("seo_keywords"),
  status: text("status").notNull().default("draft"),
  hookStrength: integer("hook_strength"),
  conversionPotential: integer("conversion_potential"),
  engagementPotential: integer("engagement_potential"),
  viralPotential: integer("viral_potential"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContentSchema = createInsertSchema(contentTable).omit({ id: true, createdAt: true });
export type InsertContent = z.infer<typeof insertContentSchema>;
export type Content = typeof contentTable.$inferSelect;

export const socialPostsTable = pgTable("social_posts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  caption: text("caption").notNull(),
  hashtags: text("hashtags"),
  cta: text("cta"),
  imageUrl: text("image_url"),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  externalPostId: text("external_post_id"),
  publishingAt: timestamp("publishing_at", { withTimezone: true }),
  statsLikes: integer("stats_likes"),
  statsComments: integer("stats_comments"),
  statsReach: integer("stats_reach"),
  statsUpdatedAt: timestamp("stats_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSocialPostSchema = createInsertSchema(socialPostsTable).omit({ id: true, createdAt: true });
export type InsertSocialPost = z.infer<typeof insertSocialPostSchema>;
export type SocialPost = typeof socialPostsTable.$inferSelect;

export const emailCampaignsTable = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  previewText: text("preview_text"),
  status: text("status").notNull().default("draft"),
  openRate: text("open_rate"),
  clickRate: text("click_rate"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaignsTable).omit({ id: true, createdAt: true });
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;

export const adCreativesTable = pgTable("ad_creatives", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  headline: text("headline").notNull(),
  description: text("description"),
  cta: text("cta"),
  imageUrl: text("image_url"),
  type: text("type").notNull().default("image"),
  hookStrength: integer("hook_strength"),
  conversionPotential: integer("conversion_potential"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdCreativeSchema = createInsertSchema(adCreativesTable).omit({ id: true, createdAt: true });
export type InsertAdCreative = z.infer<typeof insertAdCreativeSchema>;
export type AdCreative = typeof adCreativesTable.$inferSelect;
