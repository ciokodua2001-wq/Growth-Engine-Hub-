import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { videosTable } from "./videos";

export type KlingSceneJobStatus = "pending" | "submitted" | "processing" | "succeed" | "failed";

export const klingSceneJobsTable = pgTable("kling_scene_jobs", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id")
    .notNull()
    .references(() => videosTable.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index").notNull(),
  prompt: text("prompt").notNull(),
  klingTaskId: text("kling_task_id"),
  externalTaskId: text("external_task_id"),
  status: text("status").notNull().default("pending"),
  model: text("model").notNull().default("kling-v2-6"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  videoUrl: text("video_url"),
  durationSec: integer("duration_sec"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KlingSceneJob = typeof klingSceneJobsTable.$inferSelect;
export type InsertKlingSceneJob = typeof klingSceneJobsTable.$inferInsert;
