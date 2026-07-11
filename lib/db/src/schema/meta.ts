import { pgTable, text, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const metaConnectionsTable = pgTable("meta_connections", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  pageAccessToken: text("page_access_token").notNull(),
  instagramAccountId: text("instagram_account_id"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("meta_connections_project_idx").on(t.projectId),
]);

export type MetaConnection = typeof metaConnectionsTable.$inferSelect;

/**
 * Short-lived sessions for the multi-page Facebook picker flow.
 * Replaces the previous in-memory Map so sessions survive server restarts.
 * Rows expire after 5 minutes (enforced on read + periodic cleanup on write).
 * `pagesEncrypted` holds AES-256-GCM-encrypted JSON of PendingPage[].
 */
export const metaPageSessionsTable = pgTable("meta_page_sessions", {
  token: text("token").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  pagesEncrypted: text("pages_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("meta_page_sessions_expires_idx").on(t.expiresAt),
]);

export type MetaPageSession = typeof metaPageSessionsTable.$inferSelect;
