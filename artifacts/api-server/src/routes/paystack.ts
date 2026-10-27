import { Router } from "express";
import { requireUserId } from "../lib/authz.js";
import { getRegion } from "../lib/region.js";
import {
  ANNUAL_DISCOUNT_PCT,
  NIGERIA_PLANS,
  getNigeriaPlan,
  getPlanCode,
  getPlanAmountNgn,
  type BillingInterval,
} from "../lib/nigeriaPricing.js";
import { initializeSubscription } from "../lib/paystackClient.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * GET /paystack/pricing - public Nigeria storefront pricing (NGN).
 * Annual is monthly × 12 × (1 − 15%), billed upfront.
 */
router.get("/paystack/pricing", (_req, res) => {
  res.json({
    region: "nigeria",
    currency: "NGN",
    annualDiscountPct: ANNUAL_DISCOUNT_PCT,
    plans: NIGERIA_PLANS.map((p) => ({
      slug: p.slug,
      name: p.name,
      monthlyNgn: p.monthlyNgn,
      annualNgn: p.annualNgn,
    })),
  });
});

/**
 * POST /paystack/checkout - authenticated. Starts a Paystack subscription
 * checkout (test-mode) for the given plan + interval. Server validates the
 * plan, interval, currency, and amount before contacting Paystack.
 */
router.post("/paystack/checkout", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { plan: slug, interval } = (req.body ?? {}) as { plan?: string; interval?: string };

  if (getRegion(req) !== "nigeria") {
    res.status(400).json({ error: "Paystack checkout is only available in the Nigeria region" });
    return;
  }

  const plan = slug ? getNigeriaPlan(slug) : null;
  if (!plan) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }
  if (interval !== "monthly" && interval !== "annual") {
    res.status(400).json({ error: "Invalid billing interval" });
    return;
  }

  const planCode = getPlanCode(plan.slug, interval as BillingInterval);
  const amountNgn = getPlanAmountNgn(plan.slug, interval as BillingInterval);
  if (!planCode || !amountNgn) {
    res.status(400).json({ error: "Invalid plan configuration" });
    return;
  }

  try {
    const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user?.email) {
      res.status(400).json({ error: "User email is required for Paystack checkout" });
      return;
    }

    // Regional callback: use the inbound host so the redirect stays on ng.*.
    const host = req.get("host") ?? process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
    const callbackUrl = `https://${host}/plans?paystack=success`;

    const tx = await initializeSubscription({
      email: user.email,
      planCode,
      callbackUrl,
      metadata: {
        userId,
        plan: plan.slug,
        interval,
        currency: "NGN",
        amountNgn: String(amountNgn),
      },
    });

    res.json({ authorizationUrl: tx.authorization_url, reference: tx.reference });
  } catch (err) {
    logger.error({ err }, "POST /paystack/checkout failed");
    res.status(500).json({ error: "Failed to start Paystack checkout" });
  }
});

export default router;
