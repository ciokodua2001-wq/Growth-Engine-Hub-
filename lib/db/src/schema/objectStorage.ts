import { pgTable, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * ACL metadata for objects stored in Supabase Storage.
 *
 * Supabase Storage (unlike GCS) has no first-class custom-metadata API, so
 * access-control policies that used to live on the GCS object's metadata
 * (`custom:aclPolicy`) are now tracked here instead, keyed by bucket + path.
 * See lib/objectAcl.ts for the read/write logic that uses this table.
 */
export const objectAclPoliciesTable = pgTable(
  "object_acl_policies",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    bucketName: text("bucket_name").notNull(),
    objectName: text("object_name").notNull(),
    ownerId: text("owner_id").notNull(),
    visibility: text("visibility").notNull().default("private"),
    aclRules: jsonb("acl_rules").$type<Array<{ group: { type: string; id: string }; permission: "read" | "write" }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("object_acl_policies_bucket_object_uniq").on(table.bucketName, table.objectName)],
);

export type ObjectAclPolicyRow = typeof objectAclPoliciesTable.$inferSelect;
export type InsertObjectAclPolicyRow = typeof objectAclPoliciesTable.$inferInsert;
