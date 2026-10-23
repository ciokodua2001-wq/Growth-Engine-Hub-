import { getStripeSync } from "./stripeClient.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, sql, and, or, isNull, lte } from "drizzle-orm";
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
    created?: number; // subscription creation (Unix seconds)
    items?: { data: Array<{ price: { product: string } }> };
  };

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!customerId || !sub.id) return;

  // Subscription activation timestamp (from the subscription's own `created`).
  const activatedAt = typeof sub.created === "number" ? new Date(sub.created * 1000) : new Date();

  // Provider-ownership guard: NULL (legacy/unclaimed) or "stripe" → event may apply.
  // Paystack-owned subscriptions (billing_provider='paystack') are never touched here.
  const stripeOwned = or(isNull(usersTable.billingProvider), eq(usersTable.billingProvider, "stripe"));

  if (event.type === "customer.subscription.deleted") {
    // Cancel ONLY the current Stripe-owned subscription (provider + subscription id match).
    const res = await db
      .update(usersTable)
      .set({ subscriptionStatus: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(usersTable.stripeCustomerId, customerId),
        stripeOwned,
        eq(usersTable.stripeSubscriptionId, sub.id),
      ))
      .returning({ id: usersTable.id });
    if (res.length === 0) {
      logger.info({ customerId, subscriptionId: sub.id }, "Stripe: deletion skipped (ownership/stale guard)");
      return;
    }
    logger.info({ customerId }, "Stripe: subscription deleted - user marked cancelled");
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

  // Atomic conditional update: only apply when the provider is Stripe-or-unclaimed
  // AND this subscription is first (NULL) or newer/equal than the stored activation.
  const res = await db
    .update(usersTable)
    .set({
      plan,
      subscriptionStatus: isActive ? "active" : sub.status,
      stripeSubscriptionId: sub.id,
      billingProvider: "stripe",
      subscriptionActivatedAt: activatedAt,
      updatedAt: new Date(),
    })
    .where(and(
      eq(usersTable.stripeCustomerId, customerId),
      stripeOwned,
      or(isNull(usersTable.subscriptionActivatedAt), lte(usersTable.subscriptionActivatedAt, activatedAt)),
    ))
    .returning({ id: usersTable.id });

  if (res.length === 0) {
    logger.info({ customerId, subscriptionId: sub.id }, "Stripe: subscription update skipped (ownership/stale guard)");
    return;
  }

  logger.info({ customerId, plan, stripeStatus: sub.status }, "Stripe: user plan synced from subscription event");

  // Reset monthly video seconds on subscription renewal/upgrade
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    try {
      await resetMonthlySecondsForUser(res[0].id, plan);
      logger.info({ userId: res[0].id, plan }, "Monthly video seconds reset on subscription event");
    } catch (err) {
      logger.warn({ err, customerId }, "Failed to reset video wallet on subscription event - non-fatal");
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
    logger.warn({ sessionId: session.id, paymentStatus: session.payment_status }, "checkout.session.completed but payment_status != paid - skipping");
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
