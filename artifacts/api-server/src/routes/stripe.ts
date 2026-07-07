import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { stripeService } from "../stripeService.js";
import { stripeStorage } from "../stripeStorage.js";

const router: IRouter = Router();

router.get("/stripe/products", async (req, res): Promise<void> => {
  try {
    const rows = await stripeStorage.listProductsWithPrices();
    const productsMap = new Map<string, {
      id: string; name: string; description: string | null;
      metadata: Record<string, string> | null; prices: Array<{
        id: string; unit_amount: number | null; currency: string | null; recurring: unknown;
      }>;
    }>();

    for (const row of rows as Record<string, unknown>[]) {
      const pid = row.product_id as string;
      if (!productsMap.has(pid)) {
        productsMap.set(pid, {
          id: pid,
          name: row.product_name as string,
          description: (row.product_description as string) ?? null,
          metadata: (row.product_metadata as Record<string, string>) ?? null,
          prices: [],
        });
      }
      if (row.price_id) {
        productsMap.get(pid)!.prices.push({
          id: row.price_id as string,
          unit_amount: row.unit_amount as number | null,
          currency: row.currency as string | null,
          recurring: row.recurring,
        });
      }
    }

    res.json({ data: Array.from(productsMap.values()) });
  } catch (err) {
    req.log.error({ err }, "Error fetching Stripe products");
    res.json({ data: [] });
  }
});

router.post("/stripe/checkout", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { priceId } = req.body as { priceId: string };
    if (!priceId) {
      res.status(400).json({ error: "priceId is required" });
      return;
    }

    let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "User not found. Please call /api/auth/provision first." });
      return;
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const email = (auth?.sessionClaims?.email as string | undefined) ?? "";
      const customer = await stripeService.createCustomer(email, userId);
      await db.update(usersTable).set({ stripeCustomerId: customer.id }).where(eq(usersTable.id, userId));
      customerId = customer.id;
    }

    const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
    const baseUrl = domains[0] ? `https://${domains[0]}` : `${req.protocol}://${req.get("host")}`;
    const basePath = process.env.BASE_PATH ?? "";

    const session = await stripeService.createCheckoutSession(
      customerId,
      priceId,
      `${baseUrl}${basePath}/onboarding`,
      `${baseUrl}${basePath}/plans`,
    );

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Error creating checkout session");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
