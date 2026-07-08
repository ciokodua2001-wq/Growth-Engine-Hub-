import { pgTable, text, timestamp, boolean, serial, jsonb } from "drizzle-orm/pg-core";

export const featureFlagsTable = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const adminAuditLogsTable = pgTable("admin_audit_logs", {
  id: serial("id").primaryKey(),
  adminId: text("admin_id").notNull(),
  adminEmail: text("admin_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
export type InsertFeatureFlag = typeof featureFlagsTable.$inferInsert;
export type Announcement = typeof announcementsTable.$inferSelect;
export type InsertAnnouncement = typeof announcementsTable.$inferInsert;
export type AdminAuditLog = typeof adminAuditLogsTable.$inferSelect;
