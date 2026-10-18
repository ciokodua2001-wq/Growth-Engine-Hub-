import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  subscriptionUsageEventsTable,
  adminAlertsTable,
  contentIntegrityLogTable,
  videoWalletsTable,
  videoSecondLogsTable,
  teamMembersTable,
  metaPageSessionsTable,
  platformCreditTransactionsTable,
  adminAuditLogsTable,
} from "@workspace/db";

/**
 * When a new Better Auth user id maps to an email that already has a `users`
 * row (re-signup after deletion, or an auth-provider id change), adopt the
 * existing row instead of creating a duplicate: free the old email slot,
 * insert the new id, repoint every FK that referenced the old id, then delete
 * the old row. Returns true if an existing row was adopted.
 */
export async function adoptExistingUserByEmail(newId: string, email: string): Promise<boolean> {
  const matches = await db.select().from(usersTable).where(eq(usersTable.email, email));
  const old = matches.find((row) => row.id !== newId);
  if (!old) return false;

  await db.transaction(async (tx) => {
    const { id: _ignored, ...rest } = old;
    // Free the email slot first so the unique email index accepts the new row.
    await tx.update(usersTable).set({ email: null }).where(eq(usersTable.id, old.id));
    await tx.insert(usersTable).values({
      ...rest,
      id: newId,
      email,
      canAccessDev: true,
      updatedAt: new Date(),
    });
    await tx.update(projectsTable).set({ ownerId: newId }).where(eq(projectsTable.ownerId, old.id));
    await tx.update(subscriptionUsageEventsTable).set({ userId: newId }).where(eq(subscriptionUsageEventsTable.userId, old.id));
    await tx.update(adminAlertsTable).set({ userId: newId }).where(eq(adminAlertsTable.userId, old.id));
    await tx.update(contentIntegrityLogTable).set({ userId: newId }).where(eq(contentIntegrityLogTable.userId, old.id));
    await tx.update(videoWalletsTable).set({ userId: newId }).where(eq(videoWalletsTable.userId, old.id));
    await tx.update(videoSecondLogsTable).set({ userId: newId }).where(eq(videoSecondLogsTable.userId, old.id));
    await tx.update(teamMembersTable).set({ userId: newId }).where(eq(teamMembersTable.userId, old.id));
    await tx.update(teamMembersTable).set({ invitedByUserId: newId }).where(eq(teamMembersTable.invitedByUserId, old.id));
    await tx.update(metaPageSessionsTable).set({ userId: newId }).where(eq(metaPageSessionsTable.userId, old.id));
    await tx.update(platformCreditTransactionsTable).set({ userId: newId }).where(eq(platformCreditTransactionsTable.userId, old.id));
    await tx.update(adminAuditLogsTable).set({ adminId: newId }).where(eq(adminAuditLogsTable.adminId, old.id));
    await tx.delete(usersTable).where(eq(usersTable.id, old.id));
  });
  return true;
}
