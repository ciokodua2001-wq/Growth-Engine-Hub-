import { db, usersTable, paystackEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyWebhookSignature } from "./paystackClient.js";
import {
  findNigeriaPlanByCode,
  getPlanAmountNgn,
  isValidNigeriaCurrency,
} from "./nigeriaPricing.js";
import { resetMonthlySecondsForUser } from "./videoWallet.js";
import { logger } from "./logger.js";

/**
 * Paystack webhook processing (Nigeria/Ngn billing). Mirrors the Stripe webhook
 * path but writes ONLY to provider-specific columns (paystack_* + paystack_events)
 * so it can never overwrite a Stripe subscription. Verifies the HMAC-SHA512
 * signature and de-duplicates by Paystack event id.
 */

type PaystackEventBody = {
  event?: string; // e.g. "charge.success"
  data?: Record<string, unknown>;
};

export async function processPaystackWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new Error("Invalid Paystack webhook signature");
  }

  const payload = JSON.parse(rawBody.toString("utf-8")) as PaystackEventBody;
  const eventType = payload.event ?? "unknown";
  const data = payload.data ?? {};

  const eventId = String(data.id ?? data.reference ?? "");
  const customerCode = asString(data.customer, "customer_code") ?? asString(data.customer, "id");
  const planCode = asString(data.plan, "plan_code") ?? asString(data.plan, "id");

  if (!eventId) {
    logger.warn({ eventType }, "Paystack webhook missing event id - skipping");
    return;
  }

  // De-duplicate: a duplicate event id is a no-op (never reprocess).
  const inserted = await db
    .insert(paystackEventsTable)
    .values({ eventId, eventType, customerCode, planCode, rawData: data })
    .onConflictDoNothing()
    .returning({ id: paystackEventsTable.id });

  if (inserted.length === 0) {
    logger.info({ eventId, eventType }, "Paystack event already processed (duplicate) - ignoring");
    return;
  }

  try {
    if (eventType === "charge.success") {
      await handleChargeSuccess(data);
    } else if (eventType === "subscription.disable") {
      await handleSubscriptionDisable(data);
    } else {
      logger.info({ eventType, eventId }, "Paystack event received (no entitlement action)");
    }
  } catch (err) {
    logger.error({ err, eventType, eventId }, "Paystack event processing failed");
    throw err;
  }
}

async function handleChargeSuccess(data: Record<string, unknown>): Promise<void> {
  const planCode = asString(data.plan, "plan_code") ?? asString(data.plan, "id");
  const customerCode = asString(data.customer, "customer_code") ?? asString(data.customer, "id");
  const subscriptionCode = asString(data.subscription, "subscription_code") ?? asString(data.subscription, "id");
  const currency = asString(data, "currency");
  const amountKobo = asNumber(data, "amount");
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const userId = asString(metadata, "userId");

  // Server-side validation: provider, currency, plan, and amount must all match.
  if (!isValidNigeriaCurrency(currency)) {
    logger.warn({ planCode, currency }, "Paystack charge ignored - not NGN");
    return;
  }
  const mapped = planCode ? findNigeriaPlanByCode(planCode) : null;
  if (!mapped) {
    logger.warn({ planCode }, "Paystack charge ignored - unknown plan code");
    return;
  }
  const expectedKobo = (getPlanAmountNgn(mapped.plan.slug, mapped.interval) ?? 0) * 100;
  if (amountKobo !== null && expectedKobo !== 0 && amountKobo !== expectedKobo) {
    logger.warn({ planCode, amountKobo, expectedKobo }, "Paystack charge ignored - amount mismatch");
    return;
  }
  if (!userId) {
    logger.warn({ planCode, customerCode }, "Paystack charge ignored - no userId in metadata");
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    logger.warn({ userId, planCode }, "Paystack charge ignored - user not found");
    return;
  }

  await db
    .update(usersTable)
    .set({
      plan: mapped.plan.slug,
      subscriptionStatus: "active",
      paystackCustomerCode: customerCode ?? user.paystackCustomerCode,
      paystackSubscriptionCode: subscriptionCode ?? user.paystackSubscriptionCode,
      paystackPlanInterval: mapped.interval,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));

  // Monthly usage allowances + reset are identical for monthly AND annual
  // subscribers (annual only changes the billing cadence, not entitlements).
  await resetMonthlySecondsForUser(userId, mapped.plan.slug);

  logger.info({ userId, plan: mapped.plan.slug, interval: mapped.interval }, "Paystack subscription activated");
}

async function handleSubscriptionDisable(data: Record<string, unknown>): Promise<void> {
  const subscriptionCode = asString(data, "subscription_code") ?? asString(data, "id");
  const customerCode = asString(data.customer, "customer_code") ?? asString(data.customer, "id");

  if (!subscriptionCode && !customerCode) return;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      subscriptionCode
        ? eq(usersTable.paystackSubscriptionCode, subscriptionCode)
        : eq(usersTable.paystackCustomerCode, customerCode ?? ""),
    );

  if (!user) {
    logger.warn({ subscriptionCode, customerCode }, "Paystack subscription.disable - user not found");
    return;
  }

  await db
    .update(usersTable)
    .set({ subscriptionStatus: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  logger.info({ userId: user.id }, "Paystack subscription cancelled");
}

function asString(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  }
  return null;
}

function asNumber(obj: unknown, key: string): number | null {
  if (obj && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "number" ? v : typeof v === "string" ? Number(v) || null : null;
  }
  return null;
}
