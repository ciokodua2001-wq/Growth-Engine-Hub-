import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { sql, eq } from "drizzle-orm";

// ── Isolated test environment (set BEFORE importing @workspace/db) ────────────
const URL = "postgresql://ubuntu@/growthforge_nigeria_test?host=/var/run/postgresql";
const SECRET = "sk_test_integration_dummy_secret"; // NOT a real key - tests only

process.env.DATABASE_URL = URL;
process.env.PAYSTACK_SECRET_KEY = SECRET;
process.env.PAYSTACK_TEST_SECRET_KEY = SECRET;
process.env.PAYSTACK_PLAN_STARTER_MONTHLY = "pln_starter_monthly";
process.env.PAYSTACK_PLAN_STARTER_ANNUAL = "pln_starter_annual";
process.env.PAYSTACK_PLAN_GETGOING_MONTHLY = "pln_getgoing_monthly";
process.env.PAYSTACK_PLAN_GETGOING_ANNUAL = "pln_getgoing_annual";
process.env.PAYSTACK_PLAN_GROWTH_MONTHLY = "pln_growth_monthly";
process.env.PAYSTACK_PLAN_GROWTH_ANNUAL = "pln_growth_annual";
process.env.PAYSTACK_PLAN_AGENCY_MONTHLY = "pln_agency_monthly";
process.env.PAYSTACK_PLAN_AGENCY_ANNUAL = "pln_agency_annual";

// Timestamps (ISO + Unix seconds) - T1 older, T2 newer.
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-02-01T00:00:00.000Z";
const T1_UNIX = Math.floor(new Date(T1).getTime() / 1000);
const T2_UNIX = Math.floor(new Date(T2).getTime() / 1000);

// starter monthly = ₦40,000 → 4,000,000 kobo; starter annual = ₦408,000 → 40,800,000 kobo
const STARTER_MONTHLY_KOBO = 4_000_000;
const STARTER_ANNUAL_KOBO = 40_800_000;

let db: any;
let usersTable: any;
let videoWalletsTable: any;
let paystackEventsTable: any;
let processPaystackWebhook: any;
let updateUserFromSubscriptionEvent: any;

beforeAll(async () => {
  ({ db, usersTable, videoWalletsTable, paystackEventsTable } = await import("@workspace/db"));
  ({ processPaystackWebhook } = await import("../paystackWebhook.js"));
  ({ updateUserFromSubscriptionEvent } = await import("../../webhookHandlers.js"));
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE users, video_wallets, video_second_logs, paystack_events RESTART IDENTITY CASCADE`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function seedUser(id: string, overrides: Record<string, unknown> = {}) {
  await db.insert(usersTable).values({ id, email: `${id}@test.com`, ...overrides });
}

async function getUser(id: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return u;
}

function sign(body: Buffer): string {
  return crypto.createHmac("sha512", SECRET).update(body).digest("hex");
}

function paystackEvent(eventType: string, data: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ event: eventType, data }));
}

function chargeSuccess(opts: {
  eventId: string;
  userId: string;
  customerCode: string;
  subscriptionCode: string;
  planCode: string;
  amountKobo: number;
  paidAt: string;
}) {
  return paystackEvent("charge.success", {
    id: opts.eventId,
    customer: { customer_code: opts.customerCode, email: "t@example.com" },
    plan: { plan_code: opts.planCode },
    subscription: { subscription_code: opts.subscriptionCode },
    amount: opts.amountKobo,
    currency: "NGN",
    paidAt: opts.paidAt,
    createdAt: opts.paidAt,
    metadata: { userId: opts.userId },
  });
}

function stripeEvent(
  type: string,
  subId: string,
  customerId: string,
  status: string,
  createdUnix: number,
  productId?: string,
) {
  return {
    type,
    data: {
      object: {
        id: subId,
        customer: customerId,
        status,
        created: createdUnix,
        ...(productId ? { items: { data: [{ price: { product: productId } }] } } : {}),
      },
    },
  };
}

async function eventCount(eventId: string): Promise<number> {
  const rows = await db.select().from(paystackEventsTable).where(eq(paystackEventsTable.eventId, eventId));
  return rows.length;
}

async function wallet(userId: string) {
  const [w] = await db.select().from(videoWalletsTable).where(eq(videoWalletsTable.userId, userId));
  return w;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Paystack subscription ownership", () => {
  it("claims ownership on first successful activation (NULL → paystack)", async () => {
    await seedUser("u1");
    const body = chargeSuccess({
      eventId: "evt_first", userId: "u1", customerCode: "CUST_1", subscriptionCode: "sub_1",
      planCode: "pln_starter_monthly", amountKobo: STARTER_MONTHLY_KOBO, paidAt: T2,
    });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u1");
    expect(u.plan).toBe("starter");
    expect(u.subscriptionStatus).toBe("active");
    expect(u.billingProvider).toBe("paystack");
    expect(u.paystackSubscriptionCode).toBe("sub_1");
  });

  it("Paystack charge does NOT overwrite a Stripe-owned subscription", async () => {
    await seedUser("u2", {
      billingProvider: "stripe", plan: "growth", subscriptionStatus: "active",
      stripeSubscriptionId: "sub_stripe",
    });
    const body = chargeSuccess({
      eventId: "evt_p", userId: "u2", customerCode: "CUST_2", subscriptionCode: "sub_p",
      planCode: "pln_starter_monthly", amountKobo: STARTER_MONTHLY_KOBO, paidAt: T2,
    });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u2");
    expect(u.plan).toBe("growth");
    expect(u.billingProvider).toBe("stripe");
    expect(u.paystackSubscriptionCode).toBeNull();
  });

  it("Stripe cancellation does NOT downgrade a Paystack-owned subscription", async () => {
    await seedUser("u3", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackSubscriptionCode: "sub_p", stripeSubscriptionId: "sub_old",
    });
    await updateUserFromSubscriptionEvent(
      stripeEvent("customer.subscription.deleted", "sub_old", "cus_3", "canceled", T2_UNIX),
    );
    const u = await getUser("u3");
    expect(u.subscriptionStatus).toBe("active");
    expect(u.billingProvider).toBe("paystack");
  });

  it("a mismatched/abandoned charge (wrong amount) does not claim ownership", async () => {
    await seedUser("u4"); // NULL provider - e.g. checkout initiated but never correctly charged
    const body = chargeSuccess({
      eventId: "evt_wrong", userId: "u4", customerCode: "CUST_4", subscriptionCode: "sub_4",
      planCode: "pln_starter_monthly", amountKobo: 1, paidAt: T2, // wrong amount
    });
    await processPaystackWebhook(body, sign(body));
    const u = await getUser("u4");
    expect(u.billingProvider).toBeNull();
    expect(u.plan).toBe("trial");
  });
});

describe("stale / delayed webhook events", () => {
  it("ignores a Paystack charge for an older subscription (stale)", async () => {
    await seedUser("u5", {
      billingProvider: "paystack", plan: "growth", subscriptionStatus: "active",
      paystackSubscriptionCode: "sub_NEW", subscriptionActivatedAt: new Date(T2),
    });
    const body = chargeSuccess({
      eventId: "evt_stale", userId: "u5", customerCode: "CUST_5", subscriptionCode: "sub_OLD",
      planCode: "pln_starter_monthly", amountKobo: STARTER_MONTHLY_KOBO, paidAt: T1, // older
    });
    await processPaystackWebhook(body, sign(body));
    const u = await getUser("u5");
    expect(u.plan).toBe("growth");
    expect(u.paystackSubscriptionCode).toBe("sub_NEW");
  });

  it("ignores a Stripe update for an older subscription (stale)", async () => {
    await seedUser("u6", {
      billingProvider: "stripe", plan: "growth", subscriptionStatus: "active",
      stripeSubscriptionId: "sub_NEW", subscriptionActivatedAt: new Date(T2),
    });
    await updateUserFromSubscriptionEvent(
      stripeEvent("customer.subscription.updated", "sub_OLD", "cus_6", "active", T1_UNIX, "prod_test_starter"),
    );
    const u = await getUser("u6");
    expect(u.plan).toBe("growth");
    expect(u.stripeSubscriptionId).toBe("sub_NEW");
  });
});

describe("duplicate / concurrent delivery", () => {
  it("processes an event only once", async () => {
    await seedUser("u7");
    const body = chargeSuccess({
      eventId: "evt_dup", userId: "u7", customerCode: "CUST_7", subscriptionCode: "sub_7",
      planCode: "pln_starter_monthly", amountKobo: STARTER_MONTHLY_KOBO, paidAt: T2,
    });
    const sig = sign(body);
    await Promise.all([
      processPaystackWebhook(body, sig),
      processPaystackWebhook(body, sig),
    ]);
    expect(await eventCount("evt_dup")).toBe(1);
    expect((await getUser("u7")).billingProvider).toBe("paystack");
  });
});

describe("invalid signature → retry", () => {
  it("rejects a bad signature (no event recorded), then processes a valid retry", async () => {
    await seedUser("u8");
    const body = chargeSuccess({
      eventId: "evt_sig", userId: "u8", customerCode: "CUST_8", subscriptionCode: "sub_8",
      planCode: "pln_starter_monthly", amountKobo: STARTER_MONTHLY_KOBO, paidAt: T2,
    });
    await expect(processPaystackWebhook(body, "bad-signature")).rejects.toThrow(/signature/i);
    expect(await eventCount("evt_sig")).toBe(0);
    expect((await getUser("u8")).billingProvider).toBeNull();

    await processPaystackWebhook(body, sign(body));
    expect((await getUser("u8")).billingProvider).toBe("paystack");
    expect(await eventCount("evt_sig")).toBe(1);
  });
});

describe("provider/customer identity validation", () => {
  it("ignores a charge whose customer code does not match the stored customer", async () => {
    await seedUser("u9", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_A", paystackSubscriptionCode: "sub_A",
    });
    const body = chargeSuccess({
      eventId: "evt_mismatch", userId: "u9", customerCode: "CUST_B", subscriptionCode: "sub_B",
      planCode: "pln_growth_monthly", amountKobo: 25_000_000, paidAt: T2,
    });
    await processPaystackWebhook(body, sign(body));
    const u = await getUser("u9");
    expect(u.plan).toBe("starter");
    expect(u.paystackCustomerCode).toBe("CUST_A");
  });
});

describe("monthly entitlement reset for annual subscribers", () => {
  it("annual activation grants the MONTHLY allowance (not 12×)", async () => {
    await seedUser("u10");
    await db.insert(videoWalletsTable).values({
      userId: "u10", plan: "trial", monthlyVideoSeconds: 80, monthlySecondsUsed: 50, lastResetAt: new Date(T1),
    });
    const body = chargeSuccess({
      eventId: "evt_annual", userId: "u10", customerCode: "CUST_10", subscriptionCode: "sub_10",
      planCode: "pln_starter_annual", amountKobo: STARTER_ANNUAL_KOBO, paidAt: T2,
    });
    await processPaystackWebhook(body, sign(body));
    const w = await wallet("u10");
    expect(w.monthlyVideoSeconds).toBe(80); // starter monthly allocation, NOT 960
    expect(w.monthlySecondsUsed).toBe(0);
    expect(w.plan).toBe("starter");
  });
});
