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
  // Nigeria / Paystack billing (parallel to Stripe - never overwrite the
  // stripe_* columns; a user is billed by whichever provider has a non-null id).
  paystackCustomerCode: text("paystack_customer_code"),
  paystackSubscriptionCode: text("paystack_subscription_code"),
  paystackPlanInterval: text("paystack_plan_interval"),
  // Non-renewing (cancelled-at-period-end) Paystack state. When a customer asks to
  // cancel a paid subscription, Paystack marks it "non-renewing": access continues
  // until the already-paid period ends. These fields record that intent separately
  // from `subscription_status` so we don't revoke prepaid access prematurely.
  // Stripe leaves both null/false (its cancellation is immediate).
  paystackAccessEndsAt: timestamp("paystack_access_ends_at", { withTimezone: true }),
  paystackRenewalDisabled: boolean("paystack_renewal_disabled").notNull().default(false),
  plan: text("plan").notNull().default("trial"),
  subscriptionStatus: text("subscription_status").notNull().default("trial"),
  // Which provider currently owns the subscription entitlements. NULL = unclaimed
  // (legacy: the first successful activation event claims it). Values: "stripe" | "paystack".
  billingProvider: text("billing_provider"),
  // Set on successful activation; used to ignore stale events from an older
  // subscription of the same provider that arrive after a newer one.
  subscriptionActivatedAt: timestamp("subscription_activated_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
