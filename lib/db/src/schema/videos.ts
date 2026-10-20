import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
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
  renderResolution: text("render_resolution"),
  renderJobId: text("render_job_id"),
  renderStartedAt: timestamp("render_started_at", { withTimezone: true }),
  renderCompletedAt: timestamp("render_completed_at", { withTimezone: true }),
  renderError: text("render_error"),
  voiceoverUrl: text("voiceover_url"),

  // Composition settings
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  captionsEnabled: boolean("captions_enabled").notNull().default(false),

  // Narration
  narrationVoiceStyle: text("narration_voice_style"),

  // ── Creative mode (Phase B) ────────────────────────────────────────────────
  // auto | prompt | my_script. Determines whether the customer's words are a
  // creative brief (auto/prompt) or exact dialogue to preserve (my_script).
  creativeMode: text("creative_mode").notNull().default("auto"),

  // ── Script approval & versioning (Phase C) ─────────────────────────────────
  // proposed = AI-authored or customer-edited but not yet approved for filming.
  // approved = locked production script. approvedScript is the exact wording to
  // film; version increments on each approval so a video keeps the wording it
  // was actually generated from, even if the draft is later edited.
  scriptStatus: text("script_status").notNull().default("proposed"),
  approvedScript: text("approved_script"),
  approvedScriptVersion: integer("approved_script_version").notNull().default(0),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  // ── Actual-audio transcription & fidelity (Phases F/G) ─────────────────────
  // dialogueTranscript is a JSON array of { text, startSec?, endSec?, confidence? }
  // produced from the FINAL assembled audio (not from the script).
  dialogueTranscript: jsonb("dialogue_transcript"),
  transcriptStatus: text("transcript_status").notNull().default("pending"),
  fidelityStatus: text("fidelity_status").notNull().default("unverified"),
  fidelityReport: jsonb("fidelity_report"),

  // ── Optional single AI script-improvement suggestion ───────────────────────
  // Cached per script version (scriptHash) so a customer never pays twice for the
  // same suggestion. status: pending | accepted | rejected. Acceptance replaces
  // `script` and resets scriptStatus to "proposed" (re-approval required) - never
  // a silent rewrite.
  scriptSuggestion: jsonb("script_suggestion"),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
