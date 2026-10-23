import { db, usersTable, paystackEventsTable } from "@workspace/db";
import { eq, and, or, isNull, lte } from "drizzle-orm";
import { verifyWebhookSignature } from "./paystackClient.js";
import {
  findNigeriaPlanByCode,
  getPlanAmountNgn,
  isValidNigeriaCurrency,
} from "./nigeriaPricing.js";
import { resetMonthlySecondsForUser } from "./videoWallet.js";
import { logger } from "./logger.js";

/**
 * Paystack webhook processing (Nigeria/NGN billing). Mirrors the Stripe webhook
 * path but writes ONLY to provider-specific columns (paystack_* + paystack_events),
 * so it can never overwrite a Stripe subscription. Verifies the HMAC-SHA512
 * signature, de-duplicates by Paystack event id, and enforces provider ownership
 * atomically via guarded conditional updates.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  if (!eventId) {
    logger.warn({ eventType }, "Paystack webhook missing event id - skipping");
    return;
  }

  const customerCode = asString(data.customer, "customer_code") ?? asString(data.customer, "id");
  const planCode = asString(data.plan, "plan_code") ?? asString(data.plan, "id");

  // Transaction: the de-dup insert and the entitlement mutation commit together.
  // If processing throws, the insert rolls back, so Paystack's retry re-processes.
  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(paystackEventsTable)
      .values({ eventId, eventType, customerCode, planCode, rawData: data })
      .onConflictDoNothing()
      .returning({ id: paystackEventsTable.id });

    if (inserted.length === 0) {
      return { duplicate: true, activated: null as null | { userId: string; plan: string } };
    }

    if (eventType === "charge.success") {
      const activated = await handleChargeSuccess(tx, data);
      return { duplicate: false, activated };
    }
    if (eventType === "subscription.disable" || eventType === "subscription.not_renew") {
      await handleSubscriptionDisable(tx, data);
      return { duplicate: false, activated: null };
    }
    if (eventType === "invoice.payment_failed") {
      await handlePaymentFailed(tx, data);
      return { duplicate: false, activated: null };
    }
    logger.info({ eventType, eventId }, "Paystack event received (no entitlement action)");
    return { duplicate: false, activated: null };
  });

  if (outcome.duplicate) {
    logger.info({ eventId }, "Paystack duplicate event - ignored");
    return;
  }

  // Wallet reset happens AFTER commit (idempotent + self-healing via getOrCreateWallet).
  if (outcome.activated) {
    try {
      await resetMonthlySecondsForUser(outcome.activated.userId, outcome.activated.plan);
    } catch (err) {
      logger.warn({ err, ...outcome.activated }, "Wallet reset after Paystack activation failed (self-heals on next access)");
    }
  }
}

async function handleChargeSuccess(tx: Tx, data: Record<string, unknown>): Promise<{ userId: string; plan: string } | null> {
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
    return null;
  }
  const mapped = planCode ? findNigeriaPlanByCode(planCode) : null;
  if (!mapped) {
    logger.warn({ planCode }, "Paystack charge ignored - unknown plan code");
    return null;
  }
  const expectedKobo = (getPlanAmountNgn(mapped.plan.slug, mapped.interval) ?? 0) * 100;
  if (amountKobo !== null && expectedKobo !== 0 && amountKobo !== expectedKobo) {
    logger.warn({ planCode, amountKobo, expectedKobo }, "Paystack charge ignored - amount mismatch");
    return null;
  }
  if (!userId || !customerCode || !subscriptionCode) {
    logger.warn({ planCode, customerCode, subscriptionCode }, "Paystack charge ignored - missing userId/customer/subscription");
    return null;
  }

  // Activation timestamp from the charge (paidAt, fallback createdAt).
  const activatedAt = parseDate(asString(data, "paidAt") ?? asString(data, "createdAt")) ?? new Date();

  // Atomic conditional update: only apply when the provider is Paystack-or-unclaimed,
  // the customer matches (or is first), and this charge is newer/equal than the
  // stored activation. metadata.userId is the initial link; the customer/subscription
  // ids are cross-checked here so a mismatched event cannot move another user.
  const updated = await tx
    .update(usersTable)
    .set({
      plan: mapped.plan.slug,
      subscriptionStatus: "active",
      paystackCustomerCode: customerCode,
      paystackSubscriptionCode: subscriptionCode,
      paystackPlanInterval: mapped.interval,
      billingProvider: "paystack",
      subscriptionActivatedAt: activatedAt,
      updatedAt: new Date(),
    })
    .where(and(
      eq(usersTable.id, userId),
      or(isNull(usersTable.billingProvider), eq(usersTable.billingProvider, "paystack")),
      or(isNull(usersTable.paystackCustomerCode), eq(usersTable.paystackCustomerCode, customerCode)),
      or(isNull(usersTable.subscriptionActivatedAt), lte(usersTable.subscriptionActivatedAt, activatedAt)),
    ))
    .returning({ id: usersTable.id });

  if (updated.length === 0) {
    logger.info({ userId, planCode, subscriptionCode }, "Paystack charge skipped (ownership/stale guard)");
    return null;
  }

  logger.info({ userId, plan: mapped.plan.slug, interval: mapped.interval }, "Paystack subscription activated");
  return { userId, plan: mapped.plan.slug };
}

async function handleSubscriptionDisable(tx: Tx, data: Record<string, unknown>): Promise<void> {
  const subscriptionCode = asString(data, "subscription_code") ?? asString(data, "id");
  const customerCode = asString(data.customer, "customer_code") ?? asString(data.customer, "id");
  if (!subscriptionCode && !customerCode) return;

  // Cancel ONLY the current Paystack-owned subscription. Clearing the subscription
  // code lets a later re-subscribe (new plan) activate on its first charge.
  const res = await tx
    .update(usersTable)
    .set({
      subscriptionStatus: "cancelled",
      cancelledAt: new Date(),
      paystackSubscriptionCode: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(usersTable.billingProvider, "paystack"),
      subscriptionCode
        ? eq(usersTable.paystackSubscriptionCode, subscriptionCode)
        : eq(usersTable.paystackCustomerCode, customerCode ?? ""),
    ))
    .returning({ id: usersTable.id });

  if (res.length === 0) {
    logger.info({ subscriptionCode, customerCode }, "Paystack cancellation skipped (ownership/stale guard)");
    return;
  }
  logger.info({ userId: res[0].id }, "Paystack subscription cancelled");
}

async function handlePaymentFailed(tx: Tx, data: Record<string, unknown>): Promise<void> {
  const subscriptionCode = asString(data, "subscription_code") ?? asString(data.subscription, "subscription_code") ?? asString(data.subscription, "id");
  const customerCode = asString(data.customer, "customer_code") ?? asString(data.customer, "id");
  if (!subscriptionCode && !customerCode) return;

  const res = await tx
    .update(usersTable)
    .set({ subscriptionStatus: "past_due", updatedAt: new Date() })
    .where(and(
      eq(usersTable.billingProvider, "paystack"),
      subscriptionCode
        ? eq(usersTable.paystackSubscriptionCode, subscriptionCode)
        : eq(usersTable.paystackCustomerCode, customerCode ?? ""),
    ))
    .returning({ id: usersTable.id });

  if (res.length === 0) {
    logger.info({ subscriptionCode, customerCode }, "Paystack payment_failed skipped (ownership/stale guard)");
    return;
  }
  logger.info({ userId: res[0].id }, "Paystack payment failed - marked past_due");
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

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
