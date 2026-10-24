import cron from "node-cron";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Revokes access for non-renewing Paystack subscriptions once their verified paid
 * period has ended. Paystack does NOT send a webhook at the period boundary for a
 * "non-renewing" subscription, so this job (plus the lazy check in authz) is what
 * actually turns `subscription_status` from "active" to "cancelled" when access ends.
 */
export async function runSubscriptionExpiration(): Promise<number> {
  const now = new Date();

  const expired = await db
    .update(usersTable)
    .set({
      subscriptionStatus: "cancelled",
      updatedAt: new Date(),
    })
    .where(and(
      eq(usersTable.billingProvider, "paystack"),
      eq(usersTable.paystackRenewalDisabled, true),
      eq(usersTable.subscriptionStatus, "active"),
      lt(usersTable.paystackAccessEndsAt, now),
    ))
    .returning({ id: usersTable.id });

  for (const row of expired) {
    logger.info({ userId: row.id }, "Paystack subscription expired (non-renewing period ended)");
  }
  return expired.length;
}

export function startSubscriptionExpirationJob(): void {
  // Hourly: revoke access close to the paid-period boundary without waiting for a
  // Paystack webhook. The authz lazy check enforces the same boundary on every request.
  cron.schedule("0 * * * *", async () => {
    try {
      const count = await runSubscriptionExpiration();
      if (count > 0) logger.info({ expired: count }, "Subscription expiration job complete");
    } catch (err) {
      logger.error({ err }, "Subscription expiration job failed");
    }
  }, { timezone: "UTC" });

  logger.info("Subscription expiration job scheduled (hourly)");
}
