import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { videosTable } from "./videos";

export type KlingSceneJobStatus = "pending" | "submitted" | "processing" | "succeed" | "failed";

export type CommercialSceneType =
  | "hook"
  | "problem"
  | "solution"
  | "benefits"
  | "proof"
  | "cta";

export const klingSceneJobsTable = pgTable("kling_scene_jobs", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id")
    .notNull()
    .references(() => videosTable.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index").notNull(),

  // ── Scene descriptor (8 cinematic metadata fields) ────────────────────────
  sceneName: text("scene_name"),           // "Hook", "Problem", "Solution", etc.
  sceneType: text("scene_type"),           // CommercialSceneType enum value
  environment: text("environment"),        // where the scene takes place
  cameraMovement: text("camera_movement"), // how the camera moves
  lighting: text("lighting"),              // lighting style
  mood: text("mood"),                      // emotional tone
  composition: text("composition"),        // visual framing / composition
  motion: text("motion"),                  // subject action / motion
  brandStyle: text("brand_style"),         // brand visual elements
  marketingObjective: text("marketing_objective"), // what this scene achieves

  // ── Audio direction fields (v2.6 Native Audio) ───────────────────────────
  narrationLine: text("narration_line"),  // spoken line for this scene (business-specific)
  audioMood: text("audio_mood"),          // ambient + music style description

  // ── Kling render fields ───────────────────────────────────────────────────
  prompt: text("prompt").notNull(),
  klingTaskId: text("kling_task_id"),
  externalTaskId: text("external_task_id"),
  status: text("status").notNull().default("pending"),
  model: text("model").notNull().default("kling-v2-6"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  videoUrl: text("video_url"),
  durationSec: integer("duration_sec"),
  errorMessage: text("error_message"),

  // ── Prompt fingerprint — SHA-256 of (script+storyboard+cinematicPlan) ────
  // Allows decomposeBlueprint to skip the Claude AI call when the blueprint
  // hasn't changed since the last decomposition.
  promptHash: text("prompt_hash"),

  // ── Retry tracking ────────────────────────────────────────────────────────
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KlingSceneJob = typeof klingSceneJobsTable.$inferSelect;
export type InsertKlingSceneJob = typeof klingSceneJobsTable.$inferInsert;
