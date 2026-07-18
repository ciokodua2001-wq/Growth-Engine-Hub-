import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectAvatarsTable = pgTable("project_avatars", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("My Avatar"),
  photoUrl: text("photo_url").notNull(),
  instructions: text("instructions"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectAvatar = typeof projectAvatarsTable.$inferSelect;
export type NewProjectAvatar = typeof projectAvatarsTable.$inferInsert;

export const platformAvatarsTable = pgTable("platform_avatars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  gender: text("gender").notNull().default("neutral"),
  archetype: text("archetype").notNull().default("presenter"),
  previewUrl: text("preview_url").notNull(),
  heygenTalkingPhotoId: text("heygen_talking_photo_id"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformAvatar = typeof platformAvatarsTable.$inferSelect;
export type NewPlatformAvatar = typeof platformAvatarsTable.$inferInsert;
