import { Router } from "express";
import { stripeStorage } from "../stripeStorage.js";
import { stripeService } from "../stripeService.js";
import { requireUserId } from "../lib/authz.js";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * GET /stripe/products
 * Public — returns all active products with their monthly prices.
 * Used by the /plans page to map plan slugs → Stripe price IDs.
 */
router.get("/stripe/products", async (_req, res) => {
  try {
    const rows = await stripeStorage.listProductsWithPrices();

    type ProductEntry = {
      id: string;
      name: string;
      description: string;
      plan: string;
      prices: Array<{ id: string; unit_amount: number; currency: string; recurring: unknown }>;
    };

    const map = new Map<string, ProductEntry>();
    for (const row of rows) {
      const productId = row.product_id as string;
      if (!map.has(productId)) {
        const meta = row.product_metadata as Record<string, string> | null;
        map.set(productId, {
          id: productId,
          name: row.product_name as string,
          description: (row.product_description as string) ?? "",
          plan: meta?.plan ?? "",
          prices: [],
        });
      }
      if (row.price_id) {
        map.get(productId)!.prices.push({
          id: row.price_id as string,
          unit_amount: row.unit_amount as number,
          currency: row.currency as string,
          recurring: row.recurring,
        });
      }
    }

    res.json({ products: Array.from(map.values()) });
  } catch (err) {
    logger.error({ err }, "GET /stripe/products failed");
    res.status(500).json({ error: "Failed to load products" });
  }
});

/**
 * POST /stripe/checkout
 * Auth required. Creates a Stripe Checkout session for the given price ID.
 * Returns { url } — the client redirects the browser there.
 */
router.post("/stripe/checkout", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { priceId } = req.body as { priceId?: string };
  if (!priceId) {
    res.status(400).json({ error: "priceId is required" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const claims = getAuth(req).sessionClaims as Record<string, unknown> | null;
    const email =
      user.email ??
      (claims?.email as string | undefined) ??
      (claims?.primary_email_address as string | undefined) ??
      "";

    const customerId = await stripeService.findOrCreateCustomer(userId, email);

    const domain =
      process.env.REPLIT_DOMAINS?.split(",")[0] ?? req.get("host") ?? "localhost";
    const base = `https://${domain}`;

    const session = await stripeService.createCheckoutSession(
      customerId,
      priceId,
      `${base}/plans?checkout=success`,
      `${base}/plans?checkout=cancelled`,
    );

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "POST /stripe/checkout failed");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /stripe/portal
 * Auth required. Creates a Stripe Customer Portal session so the user can
 * manage/cancel their subscription.
 */
router.post("/stripe/portal", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const user = await stripeStorage.getUser(userId);
    if (!user?.stripeCustomerId) {
      res.status(400).json({ error: "No Stripe customer on file — no subscription to manage" });
      return;
    }

    const domain =
      process.env.REPLIT_DOMAINS?.split(",")[0] ?? req.get("host") ?? "localhost";
    const portal = await stripeService.createPortalSession(
      user.stripeCustomerId,
      `https://${domain}/plans`,
    );
    res.json({ url: portal.url });
  } catch (err) {
    logger.error({ err }, "POST /stripe/portal failed");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

/**
 * GET /stripe/subscription
 * Auth required. Returns the current user's plan + subscription info.
 */
router.get("/stripe/subscription", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const user = await stripeStorage.getUser(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const subscription = user.stripeSubscriptionId
      ? await stripeStorage.getSubscription(user.stripeSubscriptionId)
      : null;

    res.json({
      plan: user.plan,
      status: user.subscriptionStatus,
      subscription,
    });
  } catch (err) {
    logger.error({ err }, "GET /stripe/subscription failed");
    res.status(500).json({ error: "Failed to get subscription" });
  }
});

export default router;
