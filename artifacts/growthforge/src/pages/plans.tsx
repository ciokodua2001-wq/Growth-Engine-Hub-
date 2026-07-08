import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Zap, Loader2, Star, Clock, Bell, X } from "lucide-react";
import { Link } from "wouter";

const TRIAL_FEATURES = [
  "1 Website Analysis",
  "1 Competitor Report",
  "1 Marketing Strategy",
  "5 Social Posts",
  "1 Email Campaign",
  "1 Video Blueprint",
  "10 Forge AI Messages",
  "Full Dashboard Access",
];

const PLANS = [
  {
    name: "Starter",
    price: 39,
    color: "#00E676",
    description: "For solo founders and small businesses",
    features: [
      "1 Project",
      "Unlimited Website Analyses",
      "Unlimited Competitor Reports",
      "1 Marketing Strategy / month",
      "25 Social Posts / month",
      "5 Email Campaigns / month",
      "5 Video Generations / month (1080p)",
      "1 Bonus 4K Video / month",
      "100 Forge AI Messages / month",
      "Full Analytics Dashboard",
    ],
  },
  {
    name: "Get-Going",
    price: 99,
    color: "#00D4FF",
    highlight: "Most Popular",
    description: "For growing creators ready to scale",
    features: [
      "3 Projects",
      "Everything in Starter",
      "Unlimited Content Generation",
      "15 Video Generations / month (1080p)",
      "2 Bonus 4K Videos / month",
      "AI Campaign Builder",
      "Social Scheduling",
      "300 Forge AI Messages / month",
      "Priority Support",
    ],
  },
  {
    name: "Growth",
    price: 299,
    color: "#14F195",
    description: "For teams serious about growth",
    features: [
      "6 Projects",
      "Everything in Get-Going",
      "35 Video Generations / month (1080p)",
      "10 4K Videos / month",
      "Competitor Video Mining",
      "White-Label Reports",
      "500 Forge AI Messages / month",
      "Dedicated Onboarding",
    ],
  },
  {
    name: "Agency",
    price: 799,
    color: "#FF6B35",
    highlight: "Best Value",
    description: "For agencies managing multiple clients",
    features: [
      "20 Projects",
      "Everything in Growth",
      "120 Video Generations / month (1080p)",
      "20 4K Videos / month",
      "AI Managed Campaigns",
      "Autonomous Growth Mode",
      "Team Members",
      "Unlimited Forge AI Messages",
      "Dedicated Success Manager",
    ],
  },
];

function EarlyAccessModal({ plan, onClose }: { plan: string; onClose: () => void }) {
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
            <div className="w-12 h-12 rounded-xl bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mb-5">
              <Bell className="w-6 h-6 text-[#00E676]" />
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
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E676]/50 text-sm"
              />
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-[#00E676] text-black font-bold text-sm hover:bg-[#14F195] transition-colors"
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
            <div className="w-16 h-16 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-[#00E676]" />
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

export default function PlansPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const [startingTrial, setStartingTrial] = useState(false);
  const [earlyAccessPlan, setEarlyAccessPlan] = useState<string | null>(null);

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

      <main className="flex-1 flex flex-col items-center py-16 px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
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
          className="w-full max-w-5xl mb-8"
        >
          <div className="relative rounded-2xl border-2 border-[#00E676]/60 p-6 flex flex-col md:flex-row items-start md:items-center gap-6" style={{ backgroundColor: "#061811" }}>
            <div className="absolute -top-3.5 left-6 px-3 py-1 rounded-full bg-[#00E676] text-black text-xs font-bold flex items-center gap-1.5">
              <Star className="w-3 h-3" /> Start Here — Free
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-3 mb-1">
                <h3 className="text-2xl font-bold text-white">Free Trial</h3>
                <span className="text-[#00E676] font-semibold text-sm border border-[#00E676]/40 rounded-full px-2 py-0.5">14 days · $0</span>
              </div>
              <p className="text-white/50 text-sm mb-4">No credit card · No commitment · Access to all trial features</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                {TRIAL_FEATURES.map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-sm text-white/70">
                    <Check className="w-3.5 h-3.5 shrink-0 text-[#00E676]" />
                    {f}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleStartTrial}
              disabled={startingTrial}
              className="shrink-0 px-8 py-3.5 rounded-xl font-bold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all disabled:opacity-60 flex items-center gap-2 shadow-lg shadow-[#00E676]/25 hover:scale-[1.02]"
            >
              {startingTrial ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Zap className="w-4 h-4" /> Start Free Trial</>}
            </button>
          </div>
        </motion.div>

        {/* Paid Plan Cards */}
        <div className="w-full max-w-5xl">
          <div className="flex items-center gap-3 mb-4 justify-center">
            <div className="h-px flex-1 bg-white/8" />
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
              <Clock className="w-3 h-3 text-amber-400" />
              <span className="text-amber-400 text-xs font-semibold">Paid plans launching soon — join the waitlist</span>
            </div>
            <div className="h-px flex-1 bg-white/8" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PLANS.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className={`relative rounded-2xl border p-6 flex flex-col gap-5 ${
                  plan.highlight
                    ? "border-[#00D4FF]/30 bg-gradient-to-b from-[#00D4FF]/6 to-[#0a1628]"
                    : "border-white/8 bg-[#080f1e]"
                }`}
              >
                {plan.highlight && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold text-black"
                    style={{ background: plan.color }}
                  >
                    {plan.highlight}
                  </div>
                )}

                <div>
                  <h3 className="text-xl font-bold text-white mb-0.5">{plan.name}</h3>
                  <p className="text-white/40 text-xs mb-2">{plan.description}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">${plan.price}</span>
                    <span className="text-white/40 text-sm">/mo</span>
                  </div>
                  <p className="text-white/30 text-xs mt-1">Billed monthly · Cancel anytime</p>
                </div>

                <ul className="flex flex-col gap-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-white/70">
                      <Check className="w-4 h-4 shrink-0" style={{ color: plan.color }} />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setEarlyAccessPlan(plan.name)}
                    className="w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2"
                    style={{
                      background: plan.highlight ? plan.color : "transparent",
                      color: plan.highlight ? "#040B14" : plan.color,
                      border: plan.highlight ? "none" : `1.5px solid ${plan.color}`,
                    }}
                  >
                    <Bell className="w-3.5 h-3.5" />
                    Join Early Access
                  </button>
                  <p className="text-center text-[10px] text-white/25">
                    Billing coming soon · Get notified at launch
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="mt-10 text-white/25 text-xs text-center max-w-md">
          All paid plans will include a 14-day free trial. Upgrade, downgrade, or cancel at any time.
          Questions? <a href="mailto:hello@usegrowthforge.com" className="text-[#00E676]/50 hover:text-[#00E676]">hello@usegrowthforge.com</a>
        </p>
      </main>

      {/* Early Access Modal */}
      <AnimatePresence>
        {earlyAccessPlan && (
          <EarlyAccessModal
            plan={earlyAccessPlan}
            onClose={() => setEarlyAccessPlan(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
