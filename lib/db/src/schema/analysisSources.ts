import { pgTable, text, timestamp, integer, primaryKey, index } from "drizzle-orm/pg-core";
import { businessAnalysisTable } from "./analysis";
import { businessSourcesTable } from "./businessSources";

/**
 * Links a specific business_analysis VERSION to the sources that grounded it,
 * with an immutable snapshot of the exact content used. Because business_analysis
 * is append-only (each re-analysis inserts a new row), this join points at the
 * precise analysis result - so older analyses remain reproducible and traceable
 * even after the underlying source profile changes.
 */
export const analysisSourcesTable = pgTable(
  "analysis_sources",
  {
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => businessAnalysisTable.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => businessSourcesTable.id, { onDelete: "cascade" }),
    snapshotContent: text("snapshot_content").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.analysisId, t.sourceId] }),
    index("analysis_sources_source_id_idx").on(t.sourceId),
  ],
);

export type AnalysisSource = typeof analysisSourcesTable.$inferSelect;
