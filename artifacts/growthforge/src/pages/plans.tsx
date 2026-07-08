import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, Zap, Loader2, Star, Clock, Bell, X,
  BarChart3, PenTool, Film, Bot, Megaphone, Users,
} from "lucide-react";
import { Link } from "wouter";

const TRIAL_FEATURES = [
  "1 Project",
  "1 Website Analysis",
  "1 Competitor Report",
  "1 Marketing Strategy",
  "3 AI Customer Personas",
  "5 Social Posts",
  "1 Email Campaign",
  "5 Video Blueprints (scripts — no rendering)",
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
    name: "Starter",
    price: 39,
    color: "#00E676",
    description: "For solo founders and small businesses",
    stats: [
      { value: "1", label: "Project" },
      { value: "4 min", label: "Video / mo" },
      { value: "35", label: "Content / mo" },
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
          "25 Social Posts / month",
          "5 Email Campaigns / month",
          "5 AI Ad Creatives / month",
        ],
      },
      {
        icon: <Film className="w-3.5 h-3.5" />,
        label: "Video Studio",
        highlight: true,
        items: [
          "Video Blueprints included",
          "4 min 1080p / month",
          "Up to 16 × 15-sec or 4 × 1-min",
        ],
      },
      {
        icon: <Bot className="w-3.5 h-3.5" />,
        label: "Forge AI Agent",
        items: [
          "100 Forge AI Chats / month",
          "Full Analytics Dashboard",
        ],
      },
    ],
  },
  {
    name: "Get-Going",
    price: 99,
    color: "#00D4FF",
    highlight: "Most Popular",
    description: "For growing creators ready to scale",
    stats: [
      { value: "3", label: "Projects" },
      { value: "8+1K min", label: "Video / mo" },
      { value: "80", label: "Content / mo" },
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
          "50 Social Posts / month",
          "15 Email Campaigns / month",
          "15 AI Ad Creatives / month",
        ],
      },
      {
        icon: <Film className="w-3.5 h-3.5" />,
        label: "Video Studio",
        highlight: true,
        items: [
          "Video Blueprints included",
          "8 min 1080p — up to 32 × 15-sec",
          "1 min 4K — up to 4 × 15-sec premium",
        ],
      },
      {
        icon: <Megaphone className="w-3.5 h-3.5" />,
        label: "Campaign Performance",
        items: [
          "1 AI Performance Report / month",
          "AI Campaign Builder",
          "Social Scheduling",
        ],
      },
      {
        icon: <Bot className="w-3.5 h-3.5" />,
        label: "Forge AI Agent",
        items: [
          "300 Forge AI Chats / month",
          "Priority Support",
        ],
      },
    ],
  },
  {
    name: "Growth",
    price: 299,
    color: "#14F195",
    description: "For teams serious about growth",
    stats: [
      { value: "6", label: "Projects" },
      { value: "25+4K min", label: "Video / mo" },
      { value: "160", label: "Content / mo" },
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
          "Video Blueprints included",
          "25 min 1080p — up to 100 × 15-sec",
          "4 min 4K — up to 16 × 15-sec premium",
        ],
      },
      {
        icon: <Megaphone className="w-3.5 h-3.5" />,
        label: "Campaign Performance",
        items: [
          "2 AI Performance Reports / month",
          "White-Label Reports",
          "Dedicated Onboarding",
        ],
      },
      {
        icon: <Bot className="w-3.5 h-3.5" />,
        label: "Forge AI Agent",
        items: [
          "500 Forge AI Chats / month",
        ],
      },
    ],
  },
  {
    name: "Agency",
    price: 799,
    color: "#FF6B35",
    highlight: "Best Value",
    description: "For agencies managing multiple clients",
    stats: [
      { value: "20", label: "Projects" },
      { value: "60+10K min", label: "Video / mo" },
      { value: "320", label: "Content / mo" },
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
          "Video Blueprints included",
          "60 min 1080p — up to 240 × 15-sec",
          "10 min 4K — up to 40 × 15-sec premium",
        ],
      },
      {
        icon: <Megaphone className="w-3.5 h-3.5" />,
        label: "Campaign Performance",
        items: [
          "4 AI Performance Reports / month",
          "AI Managed Campaigns",
          "Autonomous Growth Mode",
        ],
      },
      {
        icon: <Users className="w-3.5 h-3.5" />,
        label: "Agency Tools",
        items: [
          "2,000 Forge AI Chats / month",
          "Team Members",
          "Dedicated Success Manager",
        ],
      },
    ],
  },
];

function EarlyAccessModal({ plan, color, onClose }: { plan: string; color: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ type: "spring", damping: 22, stiffness: 320 }}
        className="w-full max-w-md rounded-2xl border border-white/10 p-8 relative"
        style={{ background: "#080f1e" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {!submitted ? (
          <>
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
              style={{ background: `${color}18`, border: `1px solid ${color}33` }}
            >
              <Bell className="w-6 h-6" style={{ color }} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">Join the {plan} waitlist</h2>
            <p className="text-white/50 text-sm mb-6">
              Paid plans are launching very soon. Enter your email and we'll notify you the moment {plan} is available — with an exclusive early-access discount.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none text-sm"
                style={{ outlineColor: color }}
              />
              <button
                type="submit"
                className="w-full py-3 rounded-xl font-bold text-sm transition-colors"
                style={{ background: color, color: "#040B14" }}
              >
                Notify Me at Launch
              </button>
            </form>
            <p className="text-white/25 text-xs text-center mt-3">No spam. Unsubscribe anytime.</p>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-4"
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: `${color}22`, border: `1px solid ${color}44` }}
            >
              <Check className="w-8 h-8" style={{ color }} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">You're on the list!</h3>
            <p className="text-white/50 text-sm mb-6">
              We'll email you at <strong className="text-white">{email}</strong> the moment {plan} launches — with an exclusive early-access offer.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-full bg-white/8 text-white/70 text-sm hover:bg-white/15 transition-colors"
            >
              Back to plans
            </button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

function PlanCard({ plan, index, onSelect }: { plan: Plan; index: number; onSelect: () => void }) {
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
      {/* Colored top bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${plan.color}, ${plan.color}55)` }} />

      {/* Highlight badge */}
      {plan.highlight && (
        <div
          className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-[11px] font-bold"
          style={{ background: `${plan.color}22`, color: plan.color, border: `1px solid ${plan.color}44` }}
        >
          {plan.highlight}
        </div>
      )}

      <div className="flex flex-col flex-1 p-6 gap-5">
        {/* Header */}
        <div>
          <h3 className="text-xl font-bold text-white mb-0.5">{plan.name}</h3>
          <p className="text-white/40 text-xs mb-4">{plan.description}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-bold text-white">${plan.price}</span>
            <span className="text-white/35 text-sm">/mo</span>
          </div>
          <p className="text-white/25 text-[11px] mt-0.5">Billed monthly · Cancel anytime</p>
        </div>

        {/* Hero stats */}
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

        {/* Feature groups */}
        <div className="flex flex-col gap-4 flex-1">
          {plan.groups.map((group) => (
            <div key={group.label}>
              {/* Group header */}
              <div
                className="flex items-center gap-1.5 mb-2 pb-1.5"
                style={{ borderBottom: `1px solid rgba(255,255,255,0.05)` }}
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

              {/* Group items */}
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item, idx) => {
                  const isSubNote = item.startsWith("Up to") || item.startsWith("up to");
                  return (
                    <li
                      key={idx}
                      className={`flex items-start gap-2 ${isSubNote ? "pl-5" : ""}`}
                    >
                      {!isSubNote && (
                        <Check
                          className="w-3.5 h-3.5 shrink-0 mt-0.5"
                          style={{ color: group.highlight ? plan.color : "rgba(255,255,255,0.35)" }}
                        />
                      )}
                      {isSubNote && (
                        <span className="text-white/25 text-xs shrink-0">↳</span>
                      )}
                      <span
                        className={`text-xs leading-relaxed ${
                          isSubNote ? "text-white/30 italic" : "text-white/65"
                        }`}
                      >
                        {item}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onSelect}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.99]"
            style={
              isHighlighted
                ? { background: plan.color, color: "#040B14", boxShadow: `0 4px 24px ${plan.color}44` }
                : {
                    background: "transparent",
                    color: plan.color,
                    border: `1.5px solid ${plan.color}55`,
                  }
            }
          >
            <Bell className="w-3.5 h-3.5" />
            Join Early Access
          </button>
          <p className="text-center text-[10px] text-white/20">
            Billing coming soon · Get notified at launch
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function PlansPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const [startingTrial, setStartingTrial] = useState(false);
  const [earlyAccessPlan, setEarlyAccessPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setLocation("/sign-in"); return; }
    fetch("/api/auth/provision", { method: "POST" }).catch(() => {});
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

      <main className="flex-1 flex flex-col items-center py-14 px-4">
        {/* Page heading */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-semibold mb-4">
            <Zap className="w-3 h-3" /> 14-day free trial · No credit card required
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">
            Start growing with <span className="text-[#00E676]">AI</span>
          </h1>
          <p className="text-white/50 text-lg">Try free for 14 days. Paid plans launching soon.</p>
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
              border: "1.5px solid rgba(0,230,118,0.4)",
              background: "linear-gradient(120deg, #061811 0%, #040B14 60%)",
            }}
          >
            <div className="absolute -top-3.5 left-6 px-3 py-1 rounded-full bg-[#00E676] text-black text-xs font-bold flex items-center gap-1.5">
              <Star className="w-3 h-3" /> Start Here — Free
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-3 mb-1">
                <h3 className="text-2xl font-bold text-white">Free Trial</h3>
                <span className="text-[#00E676] font-semibold text-sm border border-[#00E676]/40 rounded-full px-2 py-0.5">
                  14 days · $0
                </span>
              </div>
              <p className="text-white/50 text-sm mb-4">
                No credit card · No commitment · Access to all trial features
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2">
                {TRIAL_FEATURES.map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-sm text-white/65">
                    <Check className="w-3.5 h-3.5 shrink-0 text-[#00E676]" />
                    {f}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleStartTrial}
              disabled={startingTrial}
              className="shrink-0 px-8 py-3.5 rounded-xl font-bold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all disabled:opacity-60 flex items-center gap-2 hover:scale-[1.02]"
              style={{ boxShadow: "0 4px 24px rgba(0,230,118,0.3)" }}
            >
              {startingTrial
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
                : <><Zap className="w-4 h-4" /> Start Free Trial</>
              }
            </button>
          </div>
        </motion.div>

        {/* Paid plans section */}
        <div className="w-full max-w-6xl">
          <div className="flex items-center gap-3 mb-6 justify-center">
            <div className="h-px flex-1 bg-white/8" />
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
              <Clock className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400 text-xs font-semibold">
                Paid plans launching soon — join the waitlist
              </span>
            </div>
            <div className="h-px flex-1 bg-white/8" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {PLANS.map((plan, i) => (
              <PlanCard
                key={plan.name}
                plan={plan}
                index={i}
                onSelect={() => setEarlyAccessPlan(plan)}
              />
            ))}
          </div>
        </div>

        <p className="mt-10 text-white/25 text-xs text-center max-w-md">
          All paid plans include a 14-day free trial. Upgrade, downgrade, or cancel at any time.{" "}
          Questions?{" "}
          <a href="mailto:hello@usegrowthforge.com" className="text-[#00E676]/50 hover:text-[#00E676]">
            hello@usegrowthforge.com
          </a>
        </p>
      </main>

      <AnimatePresence>
        {earlyAccessPlan && (
          <EarlyAccessModal
            plan={earlyAccessPlan.name}
            color={earlyAccessPlan.color}
            onClose={() => setEarlyAccessPlan(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
