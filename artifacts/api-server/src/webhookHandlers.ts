import { getStripeSync } from "./stripeClient.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./lib/logger.js";
import { creditPurchasedSeconds, resetMonthlySecondsForUser } from "./lib/videoWallet.js";

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

  const result = await db.execute(
    sql`SELECT metadata FROM stripe.products WHERE id = ${productId} LIMIT 1`,
  );
  const metadata = result.rows[0]?.metadata as Record<string, string> | null;
  const plan     = metadata?.plan ?? "starter";

  const isActive = ["active", "trialing"].includes(sub.status);
  await db
    .update(usersTable)
    .set({
      plan,
      subscriptionStatus:   isActive ? "active" : sub.status,
      stripeSubscriptionId: sub.id,
    })
    .where(eq(usersTable.stripeCustomerId, customerId));

  logger.info({ customerId, plan, stripeStatus: sub.status }, "Stripe: user plan synced from subscription event");

  // Reset monthly video seconds on subscription renewal/upgrade
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    try {
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.stripeCustomerId, customerId));
      if (user?.id) {
        await resetMonthlySecondsForUser(user.id, plan);
        logger.info({ userId: user.id, plan }, "Monthly video seconds reset on subscription event");
      }
    } catch (err) {
      logger.warn({ err, customerId }, "Failed to reset video wallet on subscription event — non-fatal");
    }
  }
}

async function handleCheckoutCompleted(event: StripeEvent): Promise<void> {
  const session = event.data.object as {
    id: string;
    metadata?: Record<string, string> | null;
    amount_total?: number | null;
    payment_status?: string;
  };

  const meta = session.metadata ?? {};
  if (meta.type !== "video_seconds") return;

  const { userId, seconds: secondsStr, plan } = meta;
  if (!userId || !secondsStr) {
    logger.warn({ sessionId: session.id }, "video_seconds checkout missing userId/seconds metadata");
    return;
  }

  const seconds      = parseInt(secondsStr, 10);
  const amountPaidUsd = (session.amount_total ?? 0) / 100;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    logger.warn({ sessionId: session.id, secondsStr }, "Invalid seconds in video_seconds checkout metadata");
    return;
  }

  if (session.payment_status !== "paid") {
    logger.warn({ sessionId: session.id, paymentStatus: session.payment_status }, "checkout.session.completed but payment_status != paid — skipping");
    return;
  }

  try {
    const balance = await creditPurchasedSeconds(userId, seconds, session.id, amountPaidUsd, plan);
    logger.info({ userId, seconds, amountPaidUsd, newBalance: balance.purchasedSecondsRemaining }, "Video credits purchased and applied");
  } catch (err) {
    logger.error({ err, userId, seconds, sessionId: session.id }, "Failed to credit purchased video seconds");
    throw err;
  }
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const event = JSON.parse(payload.toString()) as StripeEvent;

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await updateUserFromSubscriptionEvent(event);
      }

      if (event.type === "checkout.session.completed") {
        await handleCheckoutCompleted(event);
      }
    } catch (err) {
      logger.warn({ err }, "Stripe webhook: user-sync parse failed (stripe schema sync succeeded)");
    }
  }
}
