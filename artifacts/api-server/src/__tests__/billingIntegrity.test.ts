/**
 * Billing-integrity regression tests (Global, Stripe LIVE monthly).
 *
 * Covers:
 *  - failed-payment access policy (past_due 72h grace, unpaid/incomplete_expired/cancelled,
 *    recovery) enforced by requireActiveSubscription
 *  - grace-period tracking in the Stripe webhook handler (duplicate / delayed events
 *    must not extend the window; recovery clears it)
 *  - video-credit idempotency (duplicate + concurrent delivery credit exactly once;
 *    distinct purchases and cross-account protection)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db, usersTable, videoWalletsTable, videoSecondLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const HOUR = 3600 * 1000;

const U_GRACE    = "__test_billing_grace__";
const U_RECOVER  = "__test_billing_recover__";
const U_DUP      = "__test_billing_dup__";
const U_DISTINCT = "__test_billing_distinct__";
const U_CROSS_A  = "__test_billing_cross_a__";
const U_CROSS_B  = "__test_billing_cross_b__";
const CUST_ID    = "cus_test_billing";
const PRODUCT_ID = "prod_test_billing";

// Stub auth identity so requireActiveSubscription resolves a per-call user id.
vi.mock("../lib/supabaseAuth.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAuth: (req: any) => ({ userId: req?.__testUserId ?? null }),
}));

// Stub stripe-replit-sync so webhook processing never talks to Stripe.
vi.mock("../stripeClient.js", () => ({
  getStripeSync: () => ({ processWebhook: () => Promise.resolve() }),
}));

import { requireActiveSubscription } from "../lib/authz.js";
import { WebhookHandlers } from "../webhookHandlers.js";
import { creditPurchasedSeconds } from "../lib/videoWallet.js";

const ALL_USERS = [U_GRACE, U_RECOVER, U_DUP, U_DISTINCT, U_CROSS_A, U_CROSS_B];

async function cleanup() {
  for (const id of ALL_USERS) {
    await db.delete(videoSecondLogsTable).where(eq(videoSecondLogsTable.userId, id));
    await db.delete(videoWalletsTable).where(eq(videoWalletsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
  await db.execute(sql`DELETE FROM stripe.products WHERE id = ${PRODUCT_ID}`);
}

beforeAll(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS stripe`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS stripe.products (id text PRIMARY KEY, metadata jsonb)`);
  await db.execute(sql`INSERT INTO stripe.products (id, metadata) VALUES (${PRODUCT_ID}, '{"plan":"starter"}'::jsonb) ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata`);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

async function upsertUser(id: string, status: string, pastDueSince: Date | null, stripeCustomerId?: string) {
  await db.delete(usersTable).where(eq(usersTable.id, id));
  await db.insert(usersTable).values({
    id,
    email: `${id}@invalid.test`,
    subscriptionStatus: status,
    subscriptionPastDueSince: pastDueSince,
    ...(stripeCustomerId ? { stripeCustomerId } : {}),
  });
}

async function gate(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await requireActiveSubscription({ __testUserId: userId } as any, res, next);
  return {
    allowed: next.mock.calls.length > 0,
    status: res.status.mock.calls[0]?.[0],
    error: res.json.mock.calls[0]?.[0]?.error,
  };
}

async function sendSubEvent(opts: {
  type?: string;
  status: string;
  created: number;
  prevStatus?: string;
  customer?: string;
  subId?: string;
}) {
  const data: Record<string, unknown> = {
    object: {
      id: opts.subId ?? "sub_test_billing",
      customer: opts.customer ?? CUST_ID,
      status: opts.status,
      items: { data: [{ price: { product: PRODUCT_ID } }] },
    },
  };
  if (opts.prevStatus !== undefined) data.previous_attributes = { status: opts.prevStatus };
  const payload = JSON.stringify({ type: opts.type ?? "customer.subscription.updated", created: opts.created, data });
  await WebhookHandlers.processWebhook(Buffer.from(payload), "test_sig");
}

async function getUserByCustomer(customerId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.stripeCustomerId, customerId));
  return u;
}

async function getWallet(userId: string) {
  const [w] = await db.select().from(videoWalletsTable).where(eq(videoWalletsTable.userId, userId));
  return w;
}

describe("failed-payment access policy (requireActiveSubscription)", () => {
  it("allows past_due within the 72-hour grace window", async () => {
    await upsertUser(U_GRACE, "past_due", new Date(Date.now() - 1 * HOUR));
    const r = await gate(U_GRACE);
    expect(r.allowed).toBe(true);
  });

  it("blocks past_due after the 72-hour grace window", async () => {
    await upsertUser(U_GRACE, "past_due", new Date(Date.now() - 73 * HOUR));
    const r = await gate(U_GRACE);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toBe("payment_past_due");
  });

  it("blocks unpaid immediately", async () => {
    await upsertUser(U_GRACE, "unpaid", null);
    const r = await gate(U_GRACE);
    expect(r.allowed).toBe(false);
    expect(r.error).toBe("payment_required");
  });

  it("blocks incomplete_expired immediately", async () => {
    await upsertUser(U_GRACE, "incomplete_expired", null);
    const r = await gate(U_GRACE);
    expect(r.allowed).toBe(false);
    expect(r.error).toBe("payment_required");
  });

  it("blocks cancelled immediately", async () => {
    await upsertUser(U_GRACE, "cancelled", null);
    const r = await gate(U_GRACE);
    expect(r.allowed).toBe(false);
    expect(r.error).toBe("subscription_cancelled");
  });

  it("allows an active subscriber after recovery", async () => {
    await upsertUser(U_RECOVER, "active", null);
    const r = await gate(U_RECOVER);
    expect(r.allowed).toBe(true);
  });

  it("owner bypasses all subscription gates", async () => {
    await db.delete(usersTable).where(eq(usersTable.id, U_GRACE));
    await db.insert(usersTable).values({
      id: U_GRACE,
      email: `${U_GRACE}@invalid.test`,
      subscriptionStatus: "cancelled",
      isOwner: true,
    });
    const r = await gate(U_GRACE);
    expect(r.allowed).toBe(true);
  });
});

describe("grace-period tracking in the Stripe webhook handler", () => {
  it("records the first past_due entry with the authoritative Stripe event time", async () => {
    await upsertUser(U_GRACE, "active", null, CUST_ID);
    const t1 = Math.floor(Date.now() / 1000) - 10 * 3600; // 10h ago
    await sendSubEvent({ status: "past_due", created: t1, prevStatus: "active" });

    const u = await getUserByCustomer(CUST_ID);
    expect(u.subscriptionStatus).toBe("past_due");
    expect(u.subscriptionPastDueSince?.getTime()).toBeCloseTo(t1 * 1000, -3); // ~seconds precision
  });

  it("duplicate / delayed past_due events do not extend the grace window", async () => {
    await upsertUser(U_GRACE, "active", null, CUST_ID);
    const t1 = Math.floor(Date.now() / 1000) - 10 * 3600;
    const t2 = Math.floor(Date.now() / 1000) - 5 * 3600; // a later re-delivery
    await sendSubEvent({ status: "past_due", created: t1, prevStatus: "active" });
    await sendSubEvent({ status: "past_due", created: t2, prevStatus: "past_due" });

    const u = await getUserByCustomer(CUST_ID);
    expect(u.subscriptionPastDueSince?.getTime()).toBeCloseTo(t1 * 1000, -3); // still the first
  });

  it("successful recovery (active) clears the grace marker and restores access", async () => {
    await upsertUser(U_GRACE, "active", null, CUST_ID);
    const t1 = Math.floor(Date.now() / 1000) - 10 * 3600;
    await sendSubEvent({ status: "past_due", created: t1, prevStatus: "active" });

    const tRecover = Math.floor(Date.now() / 1000) - 3600;
    await sendSubEvent({ status: "active", created: tRecover, prevStatus: "past_due" });

    const u = await getUserByCustomer(CUST_ID);
    expect(u.subscriptionStatus).toBe("active");
    expect(u.subscriptionPastDueSince).toBeNull();
  });

  it("deleted event marks cancelled and clears any grace marker", async () => {
    await upsertUser(U_GRACE, "active", null, CUST_ID);
    const t1 = Math.floor(Date.now() / 1000) - 3600;
    await sendSubEvent({ status: "past_due", created: t1, prevStatus: "active" });
    await sendSubEvent({ type: "customer.subscription.deleted", status: "canceled", created: t1 + 60 });

    const u = await getUserByCustomer(CUST_ID);
    expect(u.subscriptionStatus).toBe("cancelled");
    expect(u.subscriptionPastDueSince).toBeNull();
  });
});

describe("video-credit idempotency", () => {
  it("credits a legitimate purchase exactly once", async () => {
    await upsertUser(U_DUP, "active", null);
    await creditPurchasedSeconds(U_DUP, 100, "sess_dup_1", 5);
    const w = await getWallet(U_DUP);
    expect(w.purchasedVideoSeconds).toBe(100);
  });

  it("duplicate delivery returns success without additional credit", async () => {
    await upsertUser(U_DUP, "active", null);
    await creditPurchasedSeconds(U_DUP, 100, "sess_dup_2", 5);
    const again = await creditPurchasedSeconds(U_DUP, 100, "sess_dup_2", 5);

    const w = await getWallet(U_DUP);
    expect(w.purchasedVideoSeconds).toBe(100);
    expect(again.purchasedSecondsRemaining).toBe(100);

    const logs = await db.select().from(videoSecondLogsTable).where(eq(videoSecondLogsTable.stripeSessionId, "sess_dup_2"));
    expect(logs.length).toBe(1); // single idempotency record
  });

  it("concurrent duplicate delivery credits exactly once", async () => {
    await upsertUser(U_DUP, "active", null);
    await Promise.all([
      creditPurchasedSeconds(U_DUP, 100, "sess_concurrent", 5),
      creditPurchasedSeconds(U_DUP, 100, "sess_concurrent", 5),
    ]);

    const w = await getWallet(U_DUP);
    expect(w.purchasedVideoSeconds).toBe(100);
  });

  it("two distinct legitimate purchases both credit", async () => {
    await upsertUser(U_DISTINCT, "active", null);
    await creditPurchasedSeconds(U_DISTINCT, 100, "sess_distinct_1", 5);
    await creditPurchasedSeconds(U_DISTINCT, 50, "sess_distinct_2", 2.5);

    const w = await getWallet(U_DISTINCT);
    expect(w.purchasedVideoSeconds).toBe(150);
  });

  it("a session cannot be credited to a second account (cross-account protection)", async () => {
    await upsertUser(U_CROSS_A, "active", null);
    await upsertUser(U_CROSS_B, "active", null);

    await creditPurchasedSeconds(U_CROSS_A, 100, "sess_cross", 5);
    await creditPurchasedSeconds(U_CROSS_B, 100, "sess_cross", 5); // same session, different account

    const a = await getWallet(U_CROSS_A);
    const b = await getWallet(U_CROSS_B);
    expect(a.purchasedVideoSeconds).toBe(100);
    expect(b.purchasedVideoSeconds).toBe(0); // B is not credited
  });
});
