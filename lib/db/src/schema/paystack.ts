import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Paystack webhook events - idempotency ledger for the Nigeria/Paystack billing
 * path. Each incoming Paystack event is recorded once (eventId is unique); a
 * duplicate delivery is a no-op. This is the Nigeria analogue of Stripe's
 * idempotency handling and lives in its own table so it never touches Stripe data.
 */
export const paystackEventsTable = pgTable("paystack_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(), // Paystack event id (e.g. "evt_...")
  eventType: text("event_type").notNull(),       // e.g. "charge.success", "subscription.disable"
  customerCode: text("customer_code"),
  planCode: text("plan_code"),
  rawData: jsonb("raw_data"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaystackEvent = typeof paystackEventsTable.$inferSelect;
export type InsertPaystackEvent = typeof paystackEventsTable.$inferInsert;
