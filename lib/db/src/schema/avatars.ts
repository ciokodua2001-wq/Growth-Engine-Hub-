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
