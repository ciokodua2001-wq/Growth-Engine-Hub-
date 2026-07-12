import { getUncachableStripeClient } from "./stripeClient.js";

/**
 * Seeds the four GrowthForge subscription plans in Stripe.
 * Idempotent — skips any plan whose product already exists by name.
 * Run: pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 */

const PLANS = [
  {
    name: "Starter",
    description:
      "1 project · 3 re-analyses/mo · 50 social posts · 10 email campaigns · 10 video blueprints · 200 Forge AI chats",
    price: 3900, // $39/mo
    metadata: { plan: "starter" },
  },
  {
    name: "Get-Going",
    description:
      "3 projects · 8 re-analyses/mo · 100 social posts · 30 email campaigns · 30 video blueprints · 600 Forge AI chats",
    price: 9900, // $99/mo
    metadata: { plan: "get-going" },
  },
  {
    name: "Growth",
    description:
      "6 projects · 15 re-analyses/mo · 200 social posts · 60 email campaigns · 60 video blueprints · 1,000 Forge AI chats",
    price: 29900, // $299/mo
    metadata: { plan: "growth" },
  },
  {
    name: "Agency",
    description:
      "20 projects · 30 re-analyses/mo · 400 social posts · 120 email campaigns · 120 video blueprints · 4,000 Forge AI chats · Dedicated success manager",
    price: 59900, // $599/mo
    metadata: { plan: "agency" },
  },
];

async function seedProducts() {
  console.log("Seeding GrowthForge Stripe products…");
  const stripe = await getUncachableStripeClient();

  for (const plan of PLANS) {
    const existing = await stripe.products.search({
      query: `name:'${plan.name}' AND active:'true'`,
    });

    if (existing.data.length > 0) {
      const existingProduct = existing.data[0];
      // Check if metadata.plan is set correctly; patch if needed
      if (existingProduct.metadata?.plan !== plan.metadata.plan) {
        await stripe.products.update(existingProduct.id, { metadata: plan.metadata });
        console.log(`  ✓ ${plan.name} — updated metadata.plan = "${plan.metadata.plan}"`);
      } else {
        console.log(`  ✓ ${plan.name} already exists (${existingProduct.id})`);
      }
      continue;
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: plan.metadata,
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.price,
      currency: "usd",
      recurring: { interval: "month" },
    });

    console.log(
      `  ✓ Created "${plan.name}" at $${plan.price / 100}/mo — product: ${product.id}  price: ${price.id}`,
    );
  }

  console.log("Done — run syncBackfill() to push to your local DB.");
}

seedProducts().catch((err: Error) => {
  console.error("Seed error:", err.message);
  process.exit(1);
});
