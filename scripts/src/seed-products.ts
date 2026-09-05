import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient.js";

/**
 * Seeds GrowthForge Stripe catalog products:
 *   - four monthly plans
 *   - two one-time video credit packs (45s / $10, 90s / $20)
 * Idempotent — updates description/metadata/prices on existing products.
 * Run: pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 */

const PLANS = [
  {
    name: "Starter",
    description:
      "1 project · 3 re-analyses/mo · 50 social posts · 10 email campaigns · 5 promo videos (80s included) · 200 Forge AI chats",
    price: 3900, // $39/mo
    metadata: { plan: "starter" },
  },
  {
    name: "Get-Going",
    description:
      "3 projects · 8 re-analyses/mo · 100 social posts · 30 email campaigns · 13 promo videos (200s included) · 600 Forge AI chats",
    price: 9900, // $99/mo
    metadata: { plan: "get-going" },
  },
  {
    name: "Growth",
    description:
      "6 projects · 15 re-analyses/mo · 200 social posts · 60 email campaigns · 35 promo videos (560s included) · 1,000 Forge AI chats",
    price: 24900, // $249/mo
    metadata: { plan: "growth" },
  },
  {
    name: "Agency",
    description:
      "20 projects · 30 re-analyses/mo · 400 social posts · 120 email campaigns · 70 promo videos (1,120s included) · 4,000 Forge AI chats · Dedicated success manager",
    price: 59900, // $599/mo
    metadata: { plan: "agency" },
  },
];

const CREDIT_PACKS = [
  {
    name: "Video Credits — 45 seconds",
    description:
      "45 seconds of AI video generation (3 × 15s promo videos). Purchased seconds never expire.",
    unitAmount: 1000, // $10
    seconds: 45,
  },
  {
    name: "Video Credits — 90 seconds",
    description:
      "90 seconds of AI video generation (6 × 15s promo videos). Purchased seconds never expire.",
    unitAmount: 2000, // $20
    seconds: 90,
  },
];

function findExistingPlan(products: Stripe.Product[], plan: (typeof PLANS)[number]) {
  return (
    products.find((p) => p.metadata?.plan === plan.metadata.plan) ??
    products.find((p) => p.name === plan.name) ??
    null
  );
}

function findExistingPack(products: Stripe.Product[], pack: (typeof CREDIT_PACKS)[number]) {
  return (
    products.find(
      (p) => p.metadata?.type === "video_seconds" && p.metadata?.seconds === String(pack.seconds),
    ) ?? products.find((p) => p.name === pack.name) ?? null
  );
}

async function ensureMonthlyPrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
): Promise<void> {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const monthly = prices.data.filter((p) => p.recurring?.interval === "month");
  let correct = monthly.find((p) => p.unit_amount === unitAmount);
  if (!correct) {
    correct = await stripe.prices.create({
      product: productId,
      unit_amount: unitAmount,
      currency: "usd",
      recurring: { interval: "month" },
    });
    console.log(`    + monthly price $${unitAmount / 100} (${correct.id})`);
  }
  for (const price of monthly) {
    if (price.id !== correct.id) {
      await stripe.prices.update(price.id, { active: false });
      console.log(`    − archived leftover $${(price.unit_amount ?? 0) / 100}/mo (${price.id})`);
    }
  }
  await stripe.products.update(productId, { default_price: correct.id });
}

async function ensureOneTimePrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
): Promise<void> {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const oneTime = prices.data.filter((p) => !p.recurring);
  let correct = oneTime.find((p) => p.unit_amount === unitAmount);
  if (!correct) {
    correct = await stripe.prices.create({
      product: productId,
      unit_amount: unitAmount,
      currency: "usd",
    });
    console.log(`    + one-time price $${unitAmount / 100} (${correct.id})`);
  }
  for (const price of oneTime) {
    if (price.id !== correct.id) {
      await stripe.prices.update(price.id, { active: false });
      console.log(`    − archived leftover $${(price.unit_amount ?? 0) / 100} (${price.id})`);
    }
  }
  await stripe.products.update(productId, { default_price: correct.id });
}

async function seedProducts() {
  console.log("Seeding GrowthForge Stripe products…");
  const stripe = await getUncachableStripeClient();
  const listed = await stripe.products.list({ active: true, limit: 100 });
  const products = listed.data;

  for (const plan of PLANS) {
    const existingProduct = findExistingPlan(products, plan);

    if (existingProduct) {
      const updates: { description?: string; metadata?: { plan: string } } = {};
      if (existingProduct.description !== plan.description) {
        updates.description = plan.description;
      }
      if (existingProduct.metadata?.plan !== plan.metadata.plan) {
        updates.metadata = plan.metadata;
      }
      if (Object.keys(updates).length > 0) {
        const updated = await stripe.products.update(existingProduct.id, updates);
        existingProduct.description = updated.description;
        existingProduct.metadata = updated.metadata;
        console.log(`  ✓ ${plan.name} — updated ${Object.keys(updates).join(", ")} (${existingProduct.id})`);
      } else {
        console.log(`  ✓ ${plan.name} already up to date (${existingProduct.id})`);
      }
      await ensureMonthlyPrice(stripe, existingProduct.id, plan.price);
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
    await stripe.products.update(product.id, { default_price: price.id });

    products.push(product);
    console.log(
      `  ✓ Created "${plan.name}" at $${plan.price / 100}/mo — product: ${product.id}  price: ${price.id}`,
    );
  }

  for (const pack of CREDIT_PACKS) {
    const metadata = { type: "video_seconds", seconds: String(pack.seconds) };
    const existingProduct = findExistingPack(products, pack);

    if (existingProduct) {
      const updates: { name?: string; description?: string; metadata?: typeof metadata } = {};
      if (existingProduct.name !== pack.name) updates.name = pack.name;
      if (existingProduct.description !== pack.description) updates.description = pack.description;
      if (
        existingProduct.metadata?.type !== metadata.type ||
        existingProduct.metadata?.seconds !== metadata.seconds
      ) {
        updates.metadata = metadata;
      }
      if (Object.keys(updates).length > 0) {
        await stripe.products.update(existingProduct.id, updates);
        console.log(`  ✓ ${pack.name} — updated ${Object.keys(updates).join(", ")} (${existingProduct.id})`);
      } else {
        console.log(`  ✓ ${pack.name} already up to date (${existingProduct.id})`);
      }
      await ensureOneTimePrice(stripe, existingProduct.id, pack.unitAmount);
      continue;
    }

    const product = await stripe.products.create({
      name: pack.name,
      description: pack.description,
      metadata,
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: pack.unitAmount,
      currency: "usd",
    });
    await stripe.products.update(product.id, { default_price: price.id });
    products.push(product);
    console.log(
      `  ✓ Created "${pack.name}" at $${pack.unitAmount / 100} — product: ${product.id}  price: ${price.id}`,
    );
  }

  console.log("Done — run syncBackfill() to push to your local DB.");
}

seedProducts().catch((err: Error) => {
  console.error("Seed error:", err.message);
  process.exit(1);
});
