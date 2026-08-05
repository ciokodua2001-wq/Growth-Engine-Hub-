import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { videosTable } from "./videos";

export type KlingSceneJobStatus = "pending" | "submitted" | "processing" | "succeed" | "failed";

// Which backend actually rendered (or will render) this scene. "wan" = the
// self-hosted Wan 2.7 worker on Vast.ai (default, cheap); "kling" = the
// legacy Kling AI 2.5 API (fallback, used automatically if the Wan worker
// errors — see ACTIVE_VIDEO_PROVIDER + sceneManager.ts).
export type VideoRenderProvider = "wan" | "kling";

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

  // ── Render fields (provider-agnostic; klingTaskId doubles as the Wan job id) ─
  prompt: text("prompt").notNull(),
  klingTaskId: text("kling_task_id"),
  externalTaskId: text("external_task_id"),
  status: text("status").notNull().default("pending"),
  model: text("model").notNull().default("kling-v2-6"),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  videoUrl: text("video_url"),
  durationSec: integer("duration_sec"),
  errorMessage: text("error_message"),

  // ── Wan 2.7 / multi-provider fields ───────────────────────────────────────
  // Which renderer produced (or is producing) this scene's video.
  // Defaults to "kling" so existing rows keep their historical meaning.
  provider: text("provider").$type<VideoRenderProvider>().notNull().default("kling"),
  // true = new scene cut, rendered fresh via text-to-video (T2V).
  // false = continuity scene, rendered via image-to-video (I2V) using the
  // last frame of the previous scene's clip as the starting frame.
  // Defaults to true so existing rows (all independently T2V-rendered by
  // Kling) keep their historical meaning.
  newSceneCut: boolean("new_scene_cut").notNull().default(true),
  // Object-storage URL of the source frame fed into I2V generation
  // (extracted via ffmpeg from the previous scene's rendered clip).
  // Null for T2V scenes (newSceneCut = true).
  sourceFrameUrl: text("source_frame_url"),

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
