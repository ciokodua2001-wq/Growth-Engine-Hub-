import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
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
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("connected_ad_accounts_project_provider_idx").on(t.projectId, t.provider),
]);

export type ConnectedAdAccount = typeof connectedAdAccountsTable.$inferSelect;
