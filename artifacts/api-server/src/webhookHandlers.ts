import { getStripeSync } from "./stripeClient.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./lib/logger.js";

type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

async function updateUserFromSubscriptionEvent(event: StripeEvent): Promise<void> {
  const sub = event.data.object as {
    id: string;
    customer: string | { id: string };
    status: string;
    items?: { data: Array<{ price: { product: string } }> };
  };

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!customerId) return;

  if (event.type === "customer.subscription.deleted") {
    await db
      .update(usersTable)
      .set({ subscriptionStatus: "cancelled", cancelledAt: new Date() })
      .where(eq(usersTable.stripeCustomerId, customerId));
    logger.info({ customerId }, "Stripe: subscription deleted — user marked cancelled");
    return;
  }

  const productId = sub.items?.data?.[0]?.price?.product;
  if (!productId) {
    logger.warn({ customerId, eventType: event.type }, "Stripe: no product in subscription items");
    return;
  }

  // Look up the plan slug from Stripe product metadata (synced to stripe schema)
  const result = await db.execute(
    sql`SELECT metadata FROM stripe.products WHERE id = ${productId} LIMIT 1`,
  );
  const metadata = result.rows[0]?.metadata as Record<string, string> | null;
  const plan = metadata?.plan ?? "starter";

  const isActive = ["active", "trialing"].includes(sub.status);
  await db
    .update(usersTable)
    .set({
      plan,
      subscriptionStatus: isActive ? "active" : sub.status,
      stripeSubscriptionId: sub.id,
    })
    .where(eq(usersTable.stripeCustomerId, customerId));

  logger.info({ customerId, plan, stripeStatus: sub.status }, "Stripe: user plan synced from subscription event");
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    // 1. Sync to stripe.* schema tables (verifies signature internally)
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // 2. After successful verification, parse to update our own usersTable
    try {
      const event = JSON.parse(payload.toString()) as StripeEvent;
      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await updateUserFromSubscriptionEvent(event);
      }
    } catch (err) {
      logger.warn({ err }, "Stripe webhook: user-sync parse failed (stripe schema sync succeeded)");
    }
  }
}
