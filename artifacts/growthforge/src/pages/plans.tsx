import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion } from "framer-motion";
import { Check, Zap, Loader2 } from "lucide-react";
import { Link } from "wouter";

interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string | null;
  recurring: { interval: string } | null;
}

interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, string> | null;
  prices: StripePrice[];
}

const PLAN_FEATURES: Record<string, string[]> = {
  Starter: [
    "1 project",
    "Content Engine",
    "Competitor analysis",
    "Email campaigns",
    "10 videos / month",
    "Analytics dashboard",
  ],
  Growth: [
    "5 projects",
    "Everything in Starter",
    "30 videos / month",
    "AI Agent chat",
    "Autonomous campaigns",
    "Priority support",
  ],
  Agency: [
    "Unlimited projects",
    "Everything in Growth",
    "Unlimited videos",
    "White-label reports",
    "Team collaboration",
    "Dedicated success manager",
  ],
};

const PLAN_HIGHLIGHTS: Record<string, string> = {
  Growth: "Most Popular",
  Agency: "Best Value",
};

const PLAN_COLORS: Record<string, string> = {
  Starter: "#00E676",
  Growth: "#00D4FF",
  Agency: "#14F195",
};

const FALLBACK_PLANS = [
  { name: "Starter", price: 99 },
  { name: "Growth", price: 299 },
  { name: "Agency", price: 799 },
];

export default function PlansPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [provisioned, setProvisioned] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      setLocation("/sign-in");
      return;
    }
    provisionUser();
    fetchProducts();
  }, [isLoaded, user]);

  async function provisionUser() {
    try {
      await fetch("/api/auth/provision", { method: "POST" });
      setProvisioned(true);
    } catch {
      setProvisioned(true);
    }
  }

  async function fetchProducts() {
    try {
      const res = await fetch("/api/stripe/products");
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        setProducts(data.data);
      }
    } catch {
      // Use fallback plans
    } finally {
      setLoadingProducts(false);
    }
  }

  async function handleSelectPlan(planName: string) {
    if (!provisioned) return;
    setSelectedPlan(planName);
    setCheckingOut(true);

    const product = products.find(
      (p) => p.name.toLowerCase() === planName.toLowerCase(),
    );
    const priceId = product?.prices[0]?.id;

    if (!priceId) {
      // No Stripe products configured yet — skip checkout
      setLocation("/onboarding");
      return;
    }

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLocation("/onboarding");
      }
    } catch {
      setLocation("/onboarding");
    } finally {
      setCheckingOut(false);
      setSelectedPlan(null);
    }
  }

  const plansToShow = products.length > 0
    ? products.map((p) => ({ name: p.name, price: (p.prices[0]?.unit_amount ?? 0) / 100 }))
    : FALLBACK_PLANS;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#040B14" }}>
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/5">
        <Link href="/" className="flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M20 4L10 16h7L13 28l14-16h-9l5-8z" fill="#00E676" />
          </svg>
          <span className="text-lg font-bold text-white">GrowthForge</span>
        </Link>
        <div className="flex items-center gap-2 text-sm text-white/50">
          <div className="w-5 h-5 rounded-full bg-[#00E676]/20 flex items-center justify-center">
            <Check className="w-3 h-3 text-[#00E676]" />
          </div>
          Account created
          <div className="w-4 h-px bg-white/20 mx-1" />
          <div className="w-5 h-5 rounded-full bg-[#00E676] flex items-center justify-center">
            <span className="text-[10px] font-bold text-black">2</span>
          </div>
          <span className="text-white">Choose plan</span>
          <div className="w-4 h-px bg-white/20 mx-1" />
          <div className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center">
            <span className="text-[10px] text-white/40">3</span>
          </div>
          <span className="text-white/40">Set up workspace</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center py-16 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-medium mb-4">
            <Zap className="w-3 h-3" /> 14-day free trial · No credit card required
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">
            Start growing with{" "}
            <span className="text-[#00E676]">AI</span>
          </h1>
          <p className="text-white/50 text-lg">
            Pick the plan that fits your business. Cancel anytime.
          </p>
        </motion.div>

        {loadingProducts ? (
          <div className="flex items-center gap-2 text-white/50 py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
            {plansToShow.map((plan, i) => {
              const highlight = PLAN_HIGHLIGHTS[plan.name];
              const color = PLAN_COLORS[plan.name] ?? "#00E676";
              const features = PLAN_FEATURES[plan.name] ?? [];
              const isSelected = selectedPlan === plan.name && checkingOut;

              return (
                <motion.div
                  key={plan.name}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={`relative rounded-2xl border p-6 flex flex-col gap-5 ${
                    highlight
                      ? "border-[#00D4FF]/50 bg-gradient-to-b from-[#00D4FF]/10 to-[#0a1628]"
                      : "border-white/10 bg-[#080f1e]"
                  }`}
                >
                  {highlight && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold text-black"
                      style={{ background: color }}
                    >
                      {highlight}
                    </div>
                  )}

                  <div>
                    <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-white">${plan.price}</span>
                      <span className="text-white/40 text-sm">/mo</span>
                    </div>
                    <p className="text-white/40 text-xs mt-1">Billed monthly · Cancel anytime</p>
                  </div>

                  <ul className="flex flex-col gap-2.5 flex-1">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-white/70">
                        <Check className="w-4 h-4 flex-shrink-0" style={{ color }} />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleSelectPlan(plan.name)}
                    disabled={checkingOut}
                    className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{
                      background: highlight ? color : "transparent",
                      color: highlight ? "#040B14" : color,
                      border: highlight ? "none" : `1.5px solid ${color}`,
                    }}
                  >
                    {isSelected ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</>
                    ) : (
                      "Start Free Trial"
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-white/30 text-xs text-center max-w-md">
          All plans include a 14-day free trial. You won't be charged until your trial ends.
          Upgrade, downgrade, or cancel at any time.
        </p>
      </main>
    </div>
  );
}
