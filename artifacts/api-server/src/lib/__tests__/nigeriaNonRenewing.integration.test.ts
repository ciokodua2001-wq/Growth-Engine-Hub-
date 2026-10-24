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

const STARTER_MONTHLY_KOBO = 4_000_000;
const STARTER_ANNUAL_KOBO = 40_800_000;

let db: any;
let usersTable: any;
let videoWalletsTable: any;
let paystackEventsTable: any;
let processPaystackWebhook: any;
let runSubscriptionExpiration: any;
let getOrCreateWallet: any;

beforeAll(async () => {
  ({ db, usersTable, videoWalletsTable, paystackEventsTable } = await import("@workspace/db"));
  ({ processPaystackWebhook } = await import("../paystackWebhook.js"));
  ({ runSubscriptionExpiration } = await import("../subscriptionExpirationJob.js"));
  ({ getOrCreateWallet } = await import("../videoWallet.js"));
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE users, video_wallets, video_second_logs, paystack_events RESTART IDENTITY CASCADE`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function sign(body: Buffer): string {
  return crypto.createHmac("sha512", SECRET).update(body).digest("hex");
}

function paystackEvent(eventType: string, data: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ event: eventType, data }));
}

function chargeSuccess(opts: {
  eventId: string; userId: string; customerCode: string; planCode: string;
  amountKobo: number; paidAt: string;
}) {
  return paystackEvent("charge.success", {
    id: opts.eventId,
    customer: { customer_code: opts.customerCode, email: "t@example.com" },
    plan: { plan_code: opts.planCode },
    amount: opts.amountKobo,
    currency: "NGN",
    paidAt: opts.paidAt,
    createdAt: opts.paidAt,
    metadata: { userId: opts.userId },
  });
}

function notRenew(opts: { eventId: string; subscriptionCode: string; customerCode: string; nextPaymentDate: string }) {
  return paystackEvent("subscription.not_renew", {
    id: opts.eventId,
    subscription_code: opts.subscriptionCode,
    customer: { customer_code: opts.customerCode, email: "t@example.com" },
    status: "non-renewing",
    next_payment_date: opts.nextPaymentDate,
    plan: { plan_code: "PLN_1hg0ti3i7mbsbnh", interval: "annually" },
  });
}

async function seedUser(id: string, overrides: Record<string, unknown> = {}) {
  await db.insert(usersTable).values({ id, email: `${id}@test.com`, ...overrides });
}

async function getUser(id: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return u;
}

async function eventCount(eventId: string): Promise<number> {
  const rows = await db.select().from(paystackEventsTable).where(eq(paystackEventsTable.eventId, eventId));
  return rows.length;
}

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Paystack non-renewing cancellation", () => {
  it("annual not_renew retains prepaid access until period end", async () => {
    await seedUser("u1", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_1", paystackSubscriptionCode: "SUB_1",
      subscriptionActivatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const body = notRenew({ eventId: "evt_nr_annual", subscriptionCode: "SUB_1", customerCode: "CUST_1", nextPaymentDate: FUTURE });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u1");
    expect(u.subscriptionStatus).toBe("active");        // NOT cancelled prematurely
    expect(u.paystackRenewalDisabled).toBe(true);
    expect(u.paystackAccessEndsAt?.toISOString()).toBe(FUTURE);
    expect(u.cancelledAt).not.toBeNull();               // intent recorded separately
  });

  it("monthly not_renew retains prepaid access until period end", async () => {
    await seedUser("u2", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_2", paystackSubscriptionCode: "SUB_2",
    });
    const body = notRenew({ eventId: "evt_nr_monthly", subscriptionCode: "SUB_2", customerCode: "CUST_2", nextPaymentDate: FUTURE });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u2");
    expect(u.subscriptionStatus).toBe("active");
    expect(u.paystackRenewalDisabled).toBe(true);
  });

  it("not_renew with an already-ended period cancels immediately (not premature)", async () => {
    await seedUser("u3", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_3", paystackSubscriptionCode: "SUB_3",
    });
    const body = notRenew({ eventId: "evt_nr_ended", subscriptionCode: "SUB_3", customerCode: "CUST_3", nextPaymentDate: PAST });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u3");
    expect(u.subscriptionStatus).toBe("cancelled");
  });

  it("expiration job cancels a non-renewing user whose period has ended", async () => {
    await seedUser("u4", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackRenewalDisabled: true, paystackAccessEndsAt: new Date(PAST),
    });
    const expired = await runSubscriptionExpiration();
    expect(expired).toBe(1);
    expect((await getUser("u4")).subscriptionStatus).toBe("cancelled");
  });

  it("expiration job leaves a not-yet-expired non-renewing user active", async () => {
    await seedUser("u5", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackRenewalDisabled: true, paystackAccessEndsAt: new Date(FUTURE),
    });
    const expired = await runSubscriptionExpiration();
    expect(expired).toBe(0);
    expect((await getUser("u5")).subscriptionStatus).toBe("active");
  });

  it("a later successful charge (reactivation) supersedes an earlier not_renew", async () => {
    await seedUser("u6", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_6", paystackSubscriptionCode: "SUB_6",
      paystackRenewalDisabled: true, paystackAccessEndsAt: new Date(FUTURE),
      cancelledAt: new Date("2026-06-01T00:00:00.000Z"),
      subscriptionActivatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const body = chargeSuccess({
      eventId: "evt_react", userId: "u6", customerCode: "CUST_6",
      planCode: "pln_starter_annual", amountKobo: STARTER_ANNUAL_KOBO, paidAt: "2026-07-01T00:00:00.000Z",
    });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u6");
    expect(u.subscriptionStatus).toBe("active");
    expect(u.paystackRenewalDisabled).toBe(false);
    expect(u.paystackAccessEndsAt).toBeNull();
    expect(u.cancelledAt).toBeNull();
  });

  it("delayed not_renew for an old subscription code is ignored after reactivation", async () => {
    await seedUser("u7", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_7", paystackSubscriptionCode: "SUB_NEW",
    });
    // A stale not_renew for the previous subscription code must not downgrade the new one.
    const body = notRenew({ eventId: "evt_nr_old", subscriptionCode: "SUB_OLD", customerCode: "CUST_7", nextPaymentDate: FUTURE });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u7");
    expect(u.subscriptionStatus).toBe("active");
    expect(u.paystackRenewalDisabled).toBe(false);
  });

  it("duplicate not_renew events are processed only once", async () => {
    await seedUser("u8", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackCustomerCode: "CUST_8", paystackSubscriptionCode: "SUB_8",
    });
    const body = notRenew({ eventId: "evt_nr_dup", subscriptionCode: "SUB_8", customerCode: "CUST_8", nextPaymentDate: FUTURE });
    const sig = sign(body);
    await Promise.all([processPaystackWebhook(body, sig), processPaystackWebhook(body, sig)]);
    expect(await eventCount("evt_nr_dup")).toBe(1);
  });

  it("not_renew does not touch a Stripe-owned subscription", async () => {
    await seedUser("u9", {
      billingProvider: "stripe", plan: "growth", subscriptionStatus: "active",
      stripeSubscriptionId: "sub_stripe", stripeCustomerId: "cus_9",
    });
    const body = notRenew({ eventId: "evt_nr_stripe", subscriptionCode: "SUB_9", customerCode: "CUST_9", nextPaymentDate: FUTURE });
    await processPaystackWebhook(body, sign(body));

    const u = await getUser("u9");
    expect(u.billingProvider).toBe("stripe");
    expect(u.subscriptionStatus).toBe("active");
    expect(u.paystackRenewalDisabled).toBe(false);
  });

  it("monthly wallet reset still happens during an active prepaid annual period", async () => {
    await seedUser("u10", {
      billingProvider: "paystack", plan: "starter", subscriptionStatus: "active",
      paystackRenewalDisabled: true, paystackAccessEndsAt: new Date(FUTURE),
    });
    await db.insert(videoWalletsTable).values({
      userId: "u10", plan: "starter", monthlyVideoSeconds: 80, monthlySecondsUsed: 50,
      lastResetAt: new Date("2026-01-01T00:00:00.000Z"), // last calendar month
    });
    const balance = await getOrCreateWallet("u10", "starter");
    expect(balance.monthlySecondsUsed).toBe(0); // reset happened
    expect(balance.monthlySecondsTotal).toBe(80);
    expect((await getUser("u10")).subscriptionStatus).toBe("active"); // still prepaid
  });
});
