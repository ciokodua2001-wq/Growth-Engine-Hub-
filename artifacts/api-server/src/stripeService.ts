import { getUncachableStripeClient } from "./stripeClient.js";

export class StripeService {
  async createCustomer(email: string, userId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({ email, metadata: { userId } });
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      subscription_data: { trial_period_days: 14 },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });
  }

  async seedDefaultProducts() {
    const stripe = await getUncachableStripeClient();
    const plans = [
      {
        name: "Starter",
        description: "1 project, Content Engine, Competitor analysis, Email campaigns, 10 videos/month, Analytics dashboard",
        price: 9900,
        metadata: { plan: "starter" },
      },
      {
        name: "Growth",
        description: "5 projects, everything in Starter, 30 videos/month, AI Agent, Autonomous campaigns, Priority support",
        price: 29900,
        metadata: { plan: "growth" },
      },
      {
        name: "Agency",
        description: "Unlimited projects, everything in Growth, Unlimited videos, White-label reports, Team collaboration, Dedicated success manager",
        price: 79900,
        metadata: { plan: "agency" },
      },
    ];

    for (const plan of plans) {
      const existing = await stripe.products.search({
        query: `name:'${plan.name}' AND active:'true'`,
      });
      if (existing.data.length > 0) continue;

      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: plan.metadata,
      });
      await stripe.prices.create({
        product: product.id,
        unit_amount: plan.price,
        currency: "usd",
        recurring: { interval: "month" },
      });
    }
  }
}

export const stripeService = new StripeService();
