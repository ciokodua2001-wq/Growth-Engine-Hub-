import { pgTable, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  role: text("role").notNull().default("user"),
  isOwner: boolean("is_owner").notNull().default(false),
  // Gates access to the dev.usegrowthforge.com environment (separate from
  // `role`/`isOwner`, which govern the admin console) - an admin must
  // explicitly approve each user before they can sign into dev, per
  // "Only approved users can access the development environment."
  canAccessDev: boolean("can_access_dev").notNull().default(false),
  suspended: boolean("suspended").notNull().default(false),
  isTestAccount: boolean("is_test_account").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull().default("trial"),
  subscriptionStatus: text("subscription_status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  subscriptionPastDueSince: timestamp("subscription_past_due_since", { withTimezone: true }),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // One application user per email (email may be null for provider-only rows).
  uniqueIndex("users_email_unique").on(table.email),
]);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
