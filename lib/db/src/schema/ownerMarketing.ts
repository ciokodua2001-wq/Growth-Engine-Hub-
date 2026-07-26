import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

// ─── Contacts ────────────────────────────────────────────────────────────────

export const ownerContactsTable = pgTable("owner_contacts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  company: text("company"),
  tags: text("tags").array().notNull().default([]),
  source: text("source").notNull().default("import"), // 'import' | 'manual'
  unsubscribed: boolean("unsubscribed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OwnerContact = typeof ownerContactsTable.$inferSelect;
export type InsertOwnerContact = typeof ownerContactsTable.$inferInsert;

// ─── Segments ─────────────────────────────────────────────────────────────────

export const ownerSegmentsTable = pgTable("owner_segments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** JSON blob describing the filter criteria (tags[], or platform user filters) */
  filterJson: jsonb("filter_json"),
  /** 'external' = contacts list segment | 'platform_users' = user query */
  segmentType: text("segment_type").notNull().default("external"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OwnerSegment = typeof ownerSegmentsTable.$inferSelect;
export type InsertOwnerSegment = typeof ownerSegmentsTable.$inferInsert;

// ─── Suppression List ─────────────────────────────────────────────────────────

export const ownerSuppressionListTable = pgTable("owner_suppression_list", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull().default("unsubscribed"), // 'unsubscribed' | 'bounced' | 'complaint'
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OwnerSuppressionEntry = typeof ownerSuppressionListTable.$inferSelect;

// ─── Owner Campaigns ──────────────────────────────────────────────────────────

export const ownerCampaignsTable = pgTable("owner_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** 'external' = external contacts | 'platform_users' = GrowthForge users | 'broadcast' = all platform users */
  targetType: text("target_type").notNull().default("external"),
  /** FK to ownerSegmentsTable (optional — used when targetType = 'external') */
  segmentId: integer("segment_id"),
  /** JSON filter used when targetType = 'platform_users' */
  filterJson: jsonb("filter_json"),
  status: text("status").notNull().default("draft"), // 'draft' | 'sent'
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count"),
  /** Stored as decimal strings (e.g. "24.5") — computed from raw counters */
  openRate: text("open_rate"),
  clickRate: text("click_rate"),
  bounceRate: text("bounce_rate"),
  /** Raw event counters incremented by the Resend webhook */
  opensCount: integer("opens_count").notNull().default(0),
  clicksCount: integer("clicks_count").notNull().default(0),
  bouncesCount: integer("bounces_count").notNull().default(0),
  unsubscribeCount: integer("unsubscribe_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OwnerCampaign = typeof ownerCampaignsTable.$inferSelect;
export type InsertOwnerCampaign = typeof ownerCampaignsTable.$inferInsert;

// ─── Support Tickets ──────────────────────────────────────────────────────────

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  /** Auto-classified: 'technical' | 'billing' | 'sales' | 'demo' | 'partnership' | 'feedback' | 'other' */
  category: text("category").notNull().default("other"),
  /** 'open' | 'ai_responded' | 'escalated' | 'resolved' */
  status: text("status").notNull().default("open"),
  aiResponse: text("ai_response"),
  adminReply: text("admin_reply"),
  adminRepliedAt: timestamp("admin_replied_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type InsertSupportTicket = typeof supportTicketsTable.$inferInsert;
