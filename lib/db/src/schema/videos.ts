import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  script: text("script"),
  storyboard: text("storyboard"),
  voiceover: text("voiceover"),
  cinematicPlan: text("cinematic_plan"),
  thumbnailUrl: text("thumbnail_url"),
  videoUrl: text("video_url"),
  duration: integer("duration"),
  hookStrength: integer("hook_strength"),
  engagementPotential: integer("engagement_potential"),
  viralPotential: integer("viral_potential"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // Render pipeline columns
  renderStatus: text("render_status").notNull().default("idle"),
  renderMode: text("render_mode"),
  renderResolution: text("render_resolution"),
  renderJobId: text("render_job_id"),
  renderStartedAt: timestamp("render_started_at", { withTimezone: true }),
  renderCompletedAt: timestamp("render_completed_at", { withTimezone: true }),
  renderError: text("render_error"),
  voiceoverUrl: text("voiceover_url"),
  avatarPhotoPath: text("avatar_photo_path"),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
