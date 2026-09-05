import { Router } from "express";
import type Stripe from "stripe";
import { stripeStorage } from "../stripeStorage.js";
import { stripeService } from "../stripeService.js";
import { getUncachableStripeClient } from "../stripeClient.js";
import { requireUserId } from "../lib/authz.js";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getBundleBySeconds, CREDIT_BUNDLES } from "../lib/videoConfig.js";

const router = Router();

/**
 * GET /stripe/products
 * Public — returns all active subscription products with their monthly prices.
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
      if (!meta?.plan || meta.type === "video_seconds") continue;
      const defaultPriceId =
        typeof product.default_price === "string"
          ? product.default_price
          : product.default_price?.id;
      const monthly = (pricesByProduct.get(product.id) ?? []).filter(
        (p) => p.recurring?.interval === "month",
      );
      const preferred = monthly.find((p) => p.id === defaultPriceId) ?? monthly[0];
      const productPrices = (preferred ? [preferred] : []).map((p) => ({
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
 * Auth required. Creates a Stripe Checkout session for a subscription price ID.
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
    const email  =
      user.email ??
      (claims?.email as string | undefined) ??
      (claims?.primary_email_address as string | undefined) ??
      "";

    const customerId = await stripeService.findOrCreateCustomer(userId, email);

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? req.get("host") ?? "localhost";
    const base   = `https://${domain}`;

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
 * POST /stripe/checkout/video-credits
 * Auth required. Creates a one-time Stripe Checkout session for video second bundles.
 * Body: { seconds: 45 | 90 }
 */
router.post("/stripe/checkout/video-credits", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { seconds } = req.body as { seconds?: number };
  if (!seconds) {
    res.status(400).json({ error: "seconds is required", availableBundles: CREDIT_BUNDLES });
    return;
  }

  const bundle = getBundleBySeconds(seconds);
  if (!bundle) {
    res.status(400).json({
      error:            "Invalid bundle size",
      availableBundles: CREDIT_BUNDLES,
    });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const claims  = getAuth(req).sessionClaims as Record<string, unknown> | null;
    const email   =
      user.email ??
      (claims?.email as string | undefined) ??
      (claims?.primary_email_address as string | undefined) ??
      "";

    const customerId = await stripeService.findOrCreateCustomer(userId, email);
    const stripe     = getUncachableStripeClient();

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? req.get("host") ?? "localhost";
    const base   = `https://${domain}`;

    const catalog = await stripe.products.list({ active: true, limit: 100 });
    const catalogProduct = catalog.data.find(
      (p) => p.metadata?.type === "video_seconds" && p.metadata?.seconds === String(bundle.seconds),
    );
    let lineItem: Stripe.Checkout.SessionCreateParams.LineItem | undefined;
    if (catalogProduct) {
      const prices = await stripe.prices.list({ product: catalogProduct.id, active: true, limit: 10 });
      const oneTime = prices.data.find((p) => !p.recurring && p.unit_amount === Math.round(bundle.priceUsd * 100));
      if (oneTime) {
        lineItem = { price: oneTime.id, quantity: 1 };
      }
    }
    lineItem ??= {
      price_data: {
        currency:    "usd",
        unit_amount: Math.round(bundle.priceUsd * 100),
        product_data: {
          name:        `GrowthForge Video Credits — ${bundle.label}`,
          description: `${bundle.seconds} seconds of AI video generation (${Math.floor(bundle.seconds / 15)} × 15s promo videos)`,
        },
      },
      quantity: 1,
    };

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ["card"],
      mode:                 "payment",
      line_items:           [lineItem],
      metadata: {
        type:    "video_seconds",
        userId,
        seconds: String(bundle.seconds),
        plan:    user.plan ?? "trial",
      },
      success_url: `${base}/videos?credits=success&seconds=${bundle.seconds}`,
      cancel_url:  `${base}/videos?credits=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "POST /stripe/checkout/video-credits failed");
    res.status(500).json({ error: "Failed to create video credit checkout session" });
  }
});

/**
 * POST /stripe/portal
 * Auth required. Creates a Stripe Customer Portal session.
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

    const domain  = process.env.REPLIT_DOMAINS?.split(",")[0] ?? req.get("host") ?? "localhost";
    const portal  = await stripeService.createPortalSession(
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
 * Auth required. Returns current plan + subscription info.
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

    res.json({ plan: user.plan, status: user.subscriptionStatus, subscription });
  } catch (err) {
    logger.error({ err }, "GET /stripe/subscription failed");
    res.status(500).json({ error: "Failed to get subscription" });
  }
});

export default router;
