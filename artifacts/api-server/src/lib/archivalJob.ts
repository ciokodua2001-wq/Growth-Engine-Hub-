import cron from "node-cron";
import { and, eq, isNull, lt, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, projectsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function runArchival(): Promise<{ archivedProjects: number; usersProcessed: number }> {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);

  const expiredUsers = await db
    .select({ id: usersTable.id, email: usersTable.email, cancelledAt: usersTable.cancelledAt })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.subscriptionStatus, "cancelled"),
        isNotNull(usersTable.cancelledAt),
        lt(usersTable.cancelledAt, cutoff),
      ),
    );

  if (expiredUsers.length === 0) {
    return { archivedProjects: 0, usersProcessed: 0 };
  }

  let archivedProjects = 0;

  for (const user of expiredUsers) {
    const result = await db
      .update(projectsTable)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(projectsTable.ownerId, user.id),
          isNull(projectsTable.deletedAt),
        ),
      )
      .returning({ id: projectsTable.id });

    archivedProjects += result.length;

    if (result.length > 0) {
      logger.info(
        { userId: user.id, email: user.email, projectsArchived: result.length, cancelledAt: user.cancelledAt },
        "Archived projects for expired cancelled user",
      );
    }
  }

  return { archivedProjects, usersProcessed: expiredUsers.length };
}

export function startArchivalJob(): void {
  cron.schedule("0 2 * * *", async () => {
    logger.info("Archival job starting");
    try {
      const result = await runArchival();
      logger.info(result, "Archival job complete");
    } catch (err) {
      logger.error({ err }, "Archival job failed");
    }
  }, { timezone: "UTC" });

  logger.info("Archival job scheduled (daily 02:00 UTC)");
}
