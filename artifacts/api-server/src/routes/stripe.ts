import { Router } from "express";
import { stripeStorage } from "../stripeStorage.js";
import { stripeService } from "../stripeService.js";
import { getUncachableStripeClient } from "../stripeClient.js";
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
    const stripe = getUncachableStripeClient();

    type ProductEntry = {
      id: string;
      name: string;
      description: string;
      plan: string;
      prices: Array<{ id: string; unit_amount: number; currency: string; recurring: unknown }>;
    };

    const [productsPage, pricesPage] = await Promise.all([
      stripe.products.list({ active: true, limit: 100 }),
      stripe.prices.list({ active: true, limit: 100 }),
    ]);

    const pricesByProduct = new Map<string, typeof pricesPage.data>();
    for (const price of pricesPage.data) {
      const pid = typeof price.product === "string" ? price.product : price.product.id;
      if (!pricesByProduct.has(pid)) pricesByProduct.set(pid, []);
      pricesByProduct.get(pid)!.push(price);
    }

    const map = new Map<string, ProductEntry>();
    for (const product of productsPage.data) {
      const meta = product.metadata as Record<string, string> | null;
      if (!meta?.plan) continue; // skip non-GrowthForge products
      const productPrices = (pricesByProduct.get(product.id) ?? [])
        .filter((p) => p.recurring?.interval === "month")
        .map((p) => ({
          id: p.id,
          unit_amount: p.unit_amount ?? 0,
          currency: p.currency,
          recurring: p.recurring,
        }));
      map.set(product.id, {
        id: product.id,
        name: product.name,
        description: product.description ?? "",
        plan: meta.plan,
        prices: productPrices,
      });
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
