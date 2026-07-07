import { getUncachableStripeClient } from "./stripeClient.js";

const PLANS = [
  {
    name: "Starter",
    description: "1 project · Content Engine · Competitor analysis · Email campaigns · 10 videos/month · Analytics dashboard",
    price: 9900,
    metadata: { plan: "starter" },
  },
  {
    name: "Growth",
    description: "5 projects · Everything in Starter · 30 videos/month · AI Agent chat · Autonomous campaigns · Priority support",
    price: 29900,
    metadata: { plan: "growth" },
  },
  {
    name: "Agency",
    description: "Unlimited projects · Everything in Growth · Unlimited videos · White-label reports · Team collaboration · Dedicated success manager",
    price: 79900,
    metadata: { plan: "agency" },
  },
];

async function seedProducts() {
  console.log("Seeding Stripe products...");
  const stripe = await getUncachableStripeClient();

  for (const plan of PLANS) {
    const existing = await stripe.products.search({
      query: `name:'${plan.name}' AND active:'true'`,
    });

    if (existing.data.length > 0) {
      console.log(`  ✓ ${plan.name} already exists (${existing.data[0].id})`);
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

    console.log(`  ✓ Created ${plan.name} at $${plan.price / 100}/mo — price: ${price.id}`);
  }

  console.log("Done!");
}

seedProducts().catch((err) => {
  console.error("Error seeding products:", err.message);
  process.exit(1);
});
