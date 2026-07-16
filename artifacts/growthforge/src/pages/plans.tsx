import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useUser } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, Zap, Loader2, Star, X,
  BarChart3, PenTool, Film, Bot, Megaphone, Users,
  CreditCard, ExternalLink, CheckCircle, TrendingUp,
} from "lucide-react";
import { Link } from "wouter";

const TRIAL_FEATURES = [
  "1 Project",
  "1 Website Analysis",
  "1 Competitor Report",
  "1 Marketing Strategy",
  "3 AI Customer Personas",
  "10 Social Posts",
  "2 Email Campaigns",
  "6 Video Blueprints (scripts — no rendering)",
  "10 Forge AI Chats",
  "Full Dashboard Access",
];

type StatItem = { value: string; label: string };
type FeatureGroup = {
  icon: React.ReactNode;
  label: string;
  items: string[];
  highlight?: boolean;
};
type Plan = {
  slug: string;
  name: string;
  price: number;
  color: string;
  highlight?: string;
  description: string;
  stats: StatItem[];
  groups: FeatureGroup[];
};

const PLANS: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    price: 39,
    color: "#00E676",
    description: "For solo founders and small businesses",
    stats: [
      { value: "1", label: "Project" },
      { value: "8 min", label: "Video / mo" },
      { value: "50", label: "Posts / mo" },
    ],
    groups: [
      {
        icon: <BarChart3 className="w-3.5 h-3.5" />,
        label: "Analytics & Intelligence",
        items: [
          "3 Website Re-analyses / month",
          "2 Competitor Reports / month",
          "1 Marketing Strategy / month",
          "3 AI Customer Personas / month",
        ],
      },
      {
        icon: <PenTool className="w-3.5 h-3.5" />,
        label: "Content Studio",
        items: [
          "50 Social Posts / month",
          "10 Email Campaigns / month",
          "10 AI Ad Creatives / month",
        ],
      },
      {
        icon: <Film className="w-3.5 h-3.5" />,
        label: "Video Studio",
        highlight: true,
        items: [
          "AI Video Generation",
          "8 min 1080p / month",
          "↳ Up to 32 × 15-sec or 8 × 1-min",
        ],
      },
      {
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        label: "Performance",
        items: ["1 AI Campaign Report / month"],
      },
      {
        icon: <Bot className="w-3.5 h-3.5" />,
        label: "Forge AI Agent",
        items: ["200 Forge AI Chats / month", "Full Analytics Dashboard"],
      },
    ],
  },
  {
    slug: "get-going",
    name: "Get-Going",
    price: 99,
    color: "#00D4FF",
    highlight: "Most Popular",
    description: "For growing creators ready to scale",
    stats: [
      { value: "3", label: "Projects" },
      { value: "16+2 min", label: "1080p+4K / mo" },
      { value: "100", label: "Posts / mo" },
    ],
    groups: [
      {
        icon: <BarChart3 className="w-3.5 h-3.5" />,
        label: "Analytics & Intelligence",
        items: [
          "8 Website Re-analyses / month",
          "6 Competitor Reports / month",
          "3 Marketing Strategies / month",
          "10 AI Customer Personas / month",
        ],
      },
      {
        icon: <PenTool className="w-3.5 h-3.5" />,
        label: "Content Studio",
        items: [
          "100 Social Posts / month",
          "30 Email Campaigns / month",
          "30 AI Ad Creatives / month",
        ],
      },
      {
        icon: <Film className="w-3.5 h-3.5" />,
        label: "Video Studio",
        highlight: true,
        items: [
          "AI Video Generation",
          "16 min 1080p — up to 64 × 15-sec",
          "2 min 4K — up to 8 × 15-sec premium",
        ],
      },
      {
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        label: "Performance",
        items: [
          "2 AI Campaign Reports / month",
          "AI Campaign Builder",
          "Social Scheduling",
        ],
      },
      {
        icon: <Bot className="w-3.5 h-3.5" />,
        label: "Forge AI Agent",
        items: ["600 Forge AI Chats / month", "Priority Support"],
      },
    ],
  },
  {
    slug: "growth",
    name: "Growth",
    price: 299,
    color: "#14F195",
    description: "For teams serious about growth",
    stats: [
      { value: "6", label: "Projects" },
      { value: "50+8 min", label: "1080p+4K / mo" },
      { value: "200", label: "Posts / mo" },
    ],
    groups: [
      {
        icon: <BarChart3 className="w-3.5 h-3.5" />,
        label: "Analytics & Intelligence",
        items: [
          "15 Website Re-analyses / month",
          "12 Competitor Reports / month",
          "6 Marketing Strategies / month",
          "20 AI Customer Personas / month",
          "Competitor Video Mining",
        ],
      },
      {
        icon: <PenTool className="w-3.5 h-3.5" />,
        label: "Content Studio",
        items: [
          "200 Social Posts / month",
          "60 Email Campaigns / month",
          "60 AI Ad Creatives / month",
        ],
      },
      {
        icon: <Film className="w-3.5 h-3.5" />,
        label: "Video Studio",
        highlight: true,
        items: [
          "AI Video Generation",
          "50 min 1080p — up to 200 × 15-sec",
          "8 min 4K — up to 32 × 15-sec premium",
        ],
      },
      {
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        label: "Performance",
        items: [
          "5 AI Campaign Reports / month",
          "White-Label Reports",
          "Dedicated Onboarding",
        ],
      },
      {
        icon: <Bot className="w-3.5 h-3.5" />,
        label: "Forge AI Agent",
        items: ["1,000 Forge AI Chats / month"],
      },
    ],
  },
  {
    slug: "agency",
    name: "Agency",
    price: 599,
    color: "#FF6B35",
    highlight: "Best Value",
    description: "For agencies managing multiple clients",
    stats: [
      { value: "20", label: "Projects" },
      { value: "120+20 min", label: "1080p+4K / mo" },
      { value: "400", label: "Posts / mo" },
    ],
    groups: [
      {
        icon: <BarChart3 className="w-3.5 h-3.5" />,
        label: "Analytics & Intelligence",
        items: [
          "30 Website Re-analyses / month",
          "25 Competitor Reports / month",
          "15 Marketing Strategies / month",
          "50 AI Customer Personas / month",
        ],
      },
      {
        icon: <PenTool className="w-3.5 h-3.5" />,
        label: "Content Studio",
        items: [
          "400 Social Posts / month",
          "120 Email Campaigns / month",
          "120 AI Ad Creatives / month",
        ],
      },
      {
        icon: <Film className="w-3.5 h-3.5" />,
        label: "Video Studio",
        highlight: true,
        items: [
          "AI Video Generation",
          "120 min 1080p — up to 480 × 15-sec",
          "20 min 4K — up to 80 × 15-sec premium",
        ],
      },
      {
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        label: "Performance",
        items: [
          "10 AI Campaign Reports / month",
          "AI Managed Campaigns",
          "Autonomous Growth Mode",
        ],
      },
      {
        icon: <Users className="w-3.5 h-3.5" />,
        label: "Agency Tools",
        items: [
          "4,000 Forge AI Chats / month",
          "Team Members",
          "Dedicated Success Manager",
        ],
      },
    ],
  },
];

type StripePriceMap = Record<string, string>; // plan slug → price ID

function PlanCard({
  plan,
  index,
  priceId,
  loading,
  onCheckout,
}: {
  plan: Plan;
  index: number;
  priceId?: string;
  loading: boolean;
  onCheckout: (priceId: string, planName: string) => void;
}) {
  const isHighlighted = !!plan.highlight;

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.07, type: "spring", damping: 22, stiffness: 260 }}
      className="relative flex flex-col rounded-2xl overflow-hidden"
      style={{
        border: isHighlighted ? `1.5px solid ${plan.color}50` : "1.5px solid rgba(255,255,255,0.07)",
        background: isHighlighted
          ? `linear-gradient(160deg, ${plan.color}0d 0%, #080f1e 40%)`
          : "#080f1e",
        boxShadow: isHighlighted ? `0 0 40px ${plan.color}18` : "none",
      }}
    >
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${plan.color}, ${plan.color}55)` }} />

      {plan.highlight && (
        <div
          className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-[11px] font-bold"
          style={{ background: `${plan.color}22`, color: plan.color, border: `1px solid ${plan.color}44` }}
        >
          {plan.highlight}
        </div>
      )}

      <div className="flex flex-col flex-1 p-6 gap-5">
        <div>
          <h3 className="text-xl font-bold text-white mb-0.5">{plan.name}</h3>
          <p className="text-white/40 text-xs mb-4">{plan.description}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-bold text-white">${plan.price}</span>
            <span className="text-white/35 text-sm">/mo</span>
          </div>
          <p className="text-white/25 text-[11px] mt-0.5">Billed monthly · Cancel anytime</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {plan.stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center justify-center rounded-xl py-2.5 px-1 text-center"
              style={{ background: `${plan.color}10`, border: `1px solid ${plan.color}22` }}
            >
              <span className="text-base font-bold leading-tight" style={{ color: plan.color }}>
                {stat.value}
              </span>
              <span className="text-[10px] text-white/40 leading-tight mt-0.5">{stat.label}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 flex-1">
          {plan.groups.map((group) => (
            <div key={group.label}>
              <div
                className="flex items-center gap-1.5 mb-2 pb-1.5"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span style={{ color: group.highlight ? plan.color : "rgba(255,255,255,0.3)" }}>
                  {group.icon}
                </span>
                <span
                  className="text-[10px] font-semibold tracking-wider uppercase"
                  style={{ color: group.highlight ? plan.color : "rgba(255,255,255,0.3)" }}
                >
                  {group.label}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item, idx) => {
                  const isSub = item.startsWith("↳");
                  const text = isSub ? item.slice(1).trim() : item;
                  return (
                    <li key={idx} className={`flex items-start gap-2 ${isSub ? "ml-5" : ""}`}>
                      {isSub ? (
                        <span className="shrink-0 mt-0.5 text-xs leading-none" style={{ color: "rgba(255,255,255,0.2)" }}>└</span>
                      ) : (
                        <Check
                          className="w-3.5 h-3.5 shrink-0 mt-0.5"
                          style={{ color: group.highlight ? plan.color : "rgba(255,255,255,0.35)" }}
                        />
                      )}
                      <span className={`leading-relaxed ${isSub ? "text-[11px] text-white/35 italic" : "text-xs text-white/65"}`}>{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => priceId && onCheckout(priceId, plan.name)}
            disabled={loading || !priceId}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={
              isHighlighted
                ? { background: plan.color, color: "#040B14", boxShadow: `0 4px 24px ${plan.color}44` }
                : { background: "transparent", color: plan.color, border: `1.5px solid ${plan.color}55` }
            }
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <CreditCard className="w-3.5 h-3.5" />
                Get Started
              </>
            )}
          </button>
          {!priceId && (
            <p className="text-center text-[10px] text-white/20">Loading pricing…</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function PlansPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user, isLoaded } = useUser();
  const [startingTrial, setStartingTrial] = useState(false);
  const [priceMap, setPriceMap] = useState<StripePriceMap>({});
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [userPlan, setUserPlan] = useState<string | null>(null);

  const checkoutStatus = new URLSearchParams(search).get("checkout");

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setLocation("/sign-in"); return; }
    fetch("/api/auth/provision", { method: "POST" }).catch(() => {});
  }, [isLoaded, user]);

  // Load Stripe products to get price IDs
  useEffect(() => {
    fetch("/api/stripe/products")
      .then((r) => r.json())
      .then((data: { products?: Array<{ plan: string; prices: Array<{ id: string }> }> }) => {
        const map: StripePriceMap = {};
        for (const product of data.products ?? []) {
          if (product.plan && product.prices[0]?.id) {
            map[product.plan] = product.prices[0].id;
          }
        }
        setPriceMap(map);
      })
      .catch(() => {});
  }, []);

  // Load current user subscription
  useEffect(() => {
    if (!isLoaded || !user) return;
    fetch("/api/stripe/subscription")
      .then((r) => r.json())
      .then((data: { plan?: string }) => {
        setUserPlan(data.plan ?? null);
      })
      .catch(() => {});
  }, [isLoaded, user]);

  async function handleStartTrial() {
    setStartingTrial(true);
    try {
      await fetch("/api/auth/provision", { method: "POST" });
      await fetch("/api/auth/start-trial", { method: "POST" });
    } catch { /* continue */ }
    setStartingTrial(false);
    setLocation("/onboarding");
  }

  async function handleCheckout(priceId: string, planName: string) {
    setCheckoutLoading(planName);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error ?? "Failed to start checkout. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    }
    setCheckoutLoading(null);
  }

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else alert(data.error ?? "Could not open billing portal.");
    } catch {
      alert("Network error. Please try again.");
    }
    setPortalLoading(false);
  }

  const isPaidUser = userPlan && userPlan !== "trial";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#040B14" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/5">
        <Link href="/" className="flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M20 4L10 16h7L13 28l14-16h-9l5-8z" fill="#00E676" />
          </svg>
          <span className="text-lg font-bold text-white">GrowthForge</span>
        </Link>
        <div className="flex items-center gap-3">
          {isPaidUser && (
            <button
              onClick={handleManageSubscription}
              disabled={portalLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:border-white/20 text-sm transition-colors"
            >
              {portalLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              Manage Subscription
            </button>
          )}
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
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center py-14 px-4">
        {/* Checkout status banners */}
        <AnimatePresence>
          {checkoutStatus === "success" && (
            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full max-w-6xl mb-6 flex items-center gap-3 px-5 py-4 rounded-2xl border border-[#00E676]/30 bg-[#00E676]/10"
            >
              <CheckCircle className="w-5 h-5 text-[#00E676] shrink-0" />
              <div>
                <p className="text-[#00E676] font-semibold text-sm">Subscription activated!</p>
                <p className="text-white/50 text-xs mt-0.5">
                  Welcome to GrowthForge. Your plan is now active —{" "}
                  <Link href="/dashboard" className="underline hover:text-white">
                    go to your dashboard
                  </Link>
                  .
                </p>
              </div>
            </motion.div>
          )}
          {checkoutStatus === "cancelled" && (
            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full max-w-6xl mb-6 flex items-center gap-3 px-5 py-4 rounded-2xl border border-white/10 bg-white/5"
            >
              <X className="w-5 h-5 text-white/40 shrink-0" />
              <p className="text-white/50 text-sm">Checkout cancelled — you can try again anytime.</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Page heading */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-semibold mb-4">
            <Zap className="w-3 h-3" /> 14-day free trial · No credit card required
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">
            Start growing with <span className="text-[#00E676]">AI</span>
          </h1>
          <p className="text-white/50 text-lg">Try free for 14 days, then upgrade to keep going.</p>
        </motion.div>

        {/* Free Trial Hero Card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="w-full max-w-6xl mb-8"
        >
          <div
            className="relative rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center gap-6"
            style={{
              background: "linear-gradient(135deg, #00E67608 0%, #040B14 60%)",
              border: "1.5px solid rgba(0,230,118,0.18)",
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: "#00E67615", border: "1px solid #00E67630" }}
            >
              <Star className="w-7 h-7 text-[#00E676]" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-white">Free Trial</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/30">
                  14 days
                </span>
              </div>
              <p className="text-white/50 text-sm mb-3">
                No credit card required. Explore the full platform with trial limits.
              </p>
              <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1">
                {TRIAL_FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-1.5 text-xs text-white/55">
                    <Check className="w-3 h-3 text-[#00E676] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="shrink-0">
              <button
                onClick={handleStartTrial}
                disabled={startingTrial}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#00E676] text-black font-bold text-sm hover:bg-[#14F195] transition-all disabled:opacity-60"
              >
                {startingTrial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Start Free Trial
              </button>
            </div>
          </div>
        </motion.div>

        {/* Plan cards */}
        <div className="w-full max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((plan, index) => (
            <PlanCard
              key={plan.slug}
              plan={plan}
              index={index}
              priceId={priceMap[plan.slug]}
              loading={checkoutLoading === plan.name}
              onCheckout={handleCheckout}
            />
          ))}
        </div>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-white/25 text-xs mt-10 text-center"
        >
          All plans billed monthly. Cancel anytime from your billing portal. By subscribing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-white/50">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/refund-policy" className="underline hover:text-white/50">
            Refund Policy
          </Link>
          .
        </motion.p>
      </main>
    </div>
  );
}
