import { pgTable, text, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const connectedAdAccountsTable = pgTable("connected_ad_accounts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),         // 'google_ads' | 'meta' | 'linkedin'
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  customerId: text("customer_id"),              // e.g. "1234567890"
  accountName: text("account_name"),
  accountEmail: text("account_email"),
  pageId: text("page_id"),                        // Meta: facebook page id for link ads
  pageAccessToken: text("page_access_token"),     // Meta: page access token
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("connected_ad_accounts_project_provider_idx").on(t.projectId, t.provider),
]);

export type ConnectedAdAccount = typeof connectedAdAccountsTable.$inferSelect;

export const adPlatformActionsTable = pgTable("ad_platform_actions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),                 // 'google_ads' | 'meta'
  customerId: text("customer_id"),
  campaignId: text("campaign_id"),                      // external campaign id
  actionType: text("action_type").notNull(),            // CAMPAIGN_CREATED | CAMPAIGN_PAUSED | CAMPAIGN_RESUMED | BUDGET_UPDATED | ...
  beforeState: text("before_state"),                    // JSON snapshot before the change
  afterState: text("after_state"),                      // JSON snapshot after the change
  status: text("status").notNull().default("success"),  // 'success' | 'failed'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ad_platform_actions_project_created_idx").on(t.projectId, t.createdAt),
]);

export type AdPlatformAction = typeof adPlatformActionsTable.$inferSelect;
