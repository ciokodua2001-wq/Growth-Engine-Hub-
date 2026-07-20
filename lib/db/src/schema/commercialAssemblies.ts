import { pgTable, text, serial, timestamp, integer, jsonb, numeric, bigint } from "drizzle-orm/pg-core";
import { videosTable } from "./videos";

export type AssemblyStatus = "pending" | "processing" | "complete" | "failed";
export type OutputFormat = "landscape" | "square" | "vertical";

export const commercialAssembliesTable = pgTable("commercial_assemblies", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id")
    .notNull()
    .references(() => videosTable.id, { onDelete: "cascade" }),

  outputFormat: text("output_format").notNull().default("landscape"),
  status: text("status").notNull().default("pending"),

  videoUrl: text("video_url"),
  durationSec: numeric("duration_sec", { precision: 8, scale: 2 }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),

  errorMessage: text("error_message"),
  options: jsonb("options"),

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommercialAssembly = typeof commercialAssembliesTable.$inferSelect;
export type InsertCommercialAssembly = typeof commercialAssembliesTable.$inferInsert;
