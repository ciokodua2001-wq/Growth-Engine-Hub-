import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

// ─── Student Profiles ─────────────────────────────────────────────────────────

export const zStudentProfilesTable = pgTable("z_student_profiles", {
  userId: text("user_id").primaryKey(),
  country: text("country"),
  province: text("province"),
  grade: text("grade"),
  plan: text("plan").notNull().default("free"), // 'free' | 'paid'
  monthlyLimit: integer("monthly_limit"),
  questionsUsedThisSession: integer("questions_used_this_session").notNull().default(0),
  questionsUsedThisMonth: integer("questions_used_this_month").notNull().default(0),
  lastResetAt: timestamp("last_reset_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ZStudentProfile = typeof zStudentProfilesTable.$inferSelect;
export type InsertZStudentProfile = typeof zStudentProfilesTable.$inferInsert;

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const zSessionsTable = pgTable("z_sessions", {
  id: text("id").primaryKey(), // nanoid
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  lesson: text("lesson").notNull(),
  unit: text("unit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ZSession = typeof zSessionsTable.$inferSelect;
export type InsertZSession = typeof zSessionsTable.$inferInsert;

// ─── Messages ─────────────────────────────────────────────────────────────────

export const zMessagesTable = pgTable("z_messages", {
  id: text("id").primaryKey(), // nanoid
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  audioUrl: text("audio_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ZMessage = typeof zMessagesTable.$inferSelect;
export type InsertZMessage = typeof zMessagesTable.$inferInsert;
