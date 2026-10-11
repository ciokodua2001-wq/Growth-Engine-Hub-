import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/**
 * One-to-one profile for projects whose operatingModel is "creator" or "hybrid".
 * Every field is optional/skippable - a creator must be able to onboard without
 * a registered business, physical address, or products/services.
 *
 * selfReportedStats is deliberately separate from any future authorized
 * API-retrieved metrics (which live on business_sources as retrievedContent +
 * retrievalMethod) so self-reported numbers are never conflated with verified data.
 */
export const creatorProfilesTable = pgTable("creator_profiles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .unique()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  creatorName: text("creator_name"),
  channelName: text("channel_name"),
  primaryPlatform: text("primary_platform"),
  additionalPlatforms: text("additional_platforms").array(),
  contentNiche: text("content_niche"),
  audienceDescription: text("audience_description"),
  audienceGeography: text("audience_geography"),
  contentLanguages: text("content_languages").array(),
  contentFormats: text("content_formats").array(),
  contentThemes: text("content_themes").array(),
  brandTone: text("brand_tone"),
  currentGoals: text("current_goals"),
  monetizationMethods: text("monetization_methods").array(),
  selfReportedStats: jsonb("self_reported_stats"),
  mediaKit: jsonb("media_kit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCreatorProfileSchema = createInsertSchema(creatorProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreatorProfile = z.infer<typeof insertCreatorProfileSchema>;
export type CreatorProfile = typeof creatorProfilesTable.$inferSelect;
