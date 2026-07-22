import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const videoWalletsTable = pgTable("video_wallets", {
  id:                    serial("id").primaryKey(),
  userId:                text("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  plan:                  text("plan").notNull().default("trial"),
  monthlyVideoSeconds:   integer("monthly_video_seconds").notNull().default(0),
  monthlySecondsUsed:    integer("monthly_seconds_used").notNull().default(0),
  purchasedVideoSeconds: integer("purchased_video_seconds").notNull().default(0),
  totalPurchasedSeconds: integer("total_purchased_seconds").notNull().default(0),
  totalRenderedSeconds:  integer("total_rendered_seconds").notNull().default(0),
  lastResetAt:           timestamp("last_reset_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoSecondLogsTable = pgTable("video_second_logs", {
  id:                    serial("id").primaryKey(),
  userId:                text("user_id").notNull(),
  videoId:               integer("video_id"),
  projectId:             integer("project_id"),
  type:                  text("type").notNull(),
  secondsChanged:        integer("seconds_changed").notNull(),
  fromMonthly:           integer("from_monthly").notNull().default(0),
  fromPurchased:         integer("from_purchased").notNull().default(0),
  newMonthlyBalance:     integer("new_monthly_balance").notNull().default(0),
  newPurchasedBalance:   integer("new_purchased_balance").notNull().default(0),
  description:           text("description").notNull(),
  stripeSessionId:       text("stripe_session_id"),
  amountPaidUsd:         real("amount_paid_usd"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoConfigTable = pgTable("video_config", {
  key:         text("key").primaryKey(),
  value:       text("value").notNull(),
  description: text("description"),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VideoWallet    = typeof videoWalletsTable.$inferSelect;
export type InsertVideoWallet = typeof videoWalletsTable.$inferInsert;
export type VideoSecondLog = typeof videoSecondLogsTable.$inferSelect;
export type VideoConfig    = typeof videoConfigTable.$inferSelect;
