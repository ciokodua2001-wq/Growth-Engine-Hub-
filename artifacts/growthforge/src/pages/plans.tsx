import { useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion } from "framer-motion";
import { Zap, Clock, Check, ArrowRight } from "lucide-react";
import { Link } from "wouter";

const COMING_SOON_FEATURES = [
  "Starter — 1 project, unlimited analyses, 100 AI messages/mo",
  "Growth — 5 projects, video renders, AI campaign builder",
  "Agency — Unlimited projects, white-label, team members",
  "Annual billing with up to 40% discount",
  "7-day money-back guarantee on all paid plans",
];

export default function PlansPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setLocation("/sign-in"); return; }
    provisionAndTrial();
  }, [isLoaded, user]);

  async function provisionAndTrial() {
    try {
      await fetch("/api/auth/provision", { method: "POST" });
      await fetch("/api/auth/start-trial", { method: "POST" });
    } catch { /* continue */ }
    setLocation("/onboarding");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16" style={{ background: "#040B14" }}>
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-12">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <path d="M20 4L10 16h7L13 28l14-16h-9l5-8z" fill="#00E676" />
        </svg>
        <span className="text-lg font-bold text-white">GrowthForge</span>
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg text-center"
      >
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-semibold mb-6">
          <Clock className="w-3.5 h-3.5" />
          Paid Plans — Coming Soon
        </div>

        <h1 className="text-4xl font-black text-white mb-3">
          Launching <span className="text-[#00E676]">very soon.</span>
        </h1>
        <p className="text-white/50 text-lg mb-10">
          We're putting the finishing touches on our paid plans. In the meantime,
          your <strong className="text-white">free 14-day trial</strong> gives you full access to everything.
        </p>

        {/* Trial card */}
        <div className="rounded-2xl border-2 border-[#00E676]/50 p-8 mb-8 text-left" style={{ background: "#061811" }}>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-5 h-5 text-[#00E676]" />
            <span className="text-xl font-bold text-white">Free Trial — 14 Days</span>
          </div>
          <p className="text-white/40 text-sm mb-5">No credit card required · Full access · Cancel anytime</p>
          <ul className="space-y-2.5 mb-6">
            {[
              "1 Full Website Analysis",
              "3 Competitor Reports",
              "1 Marketing Strategy",
              "5 Social Media Posts",
              "1 Email Campaign",
              "1 Video Blueprint",
              "25 Forge AI Messages",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-white/70">
                <Check className="w-4 h-4 text-[#00E676] shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <button
            onClick={provisionAndTrial}
            className="w-full py-3.5 rounded-xl bg-[#00E676] text-black font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#14F195] transition-colors"
          >
            Start Free Trial <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Coming soon paid plan teasers */}
        <div className="rounded-xl border border-white/8 p-5 text-left" style={{ background: "#080f1e" }}>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Paid plans — coming soon</p>
          <ul className="space-y-2">
            {COMING_SOON_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-white/40">
                <Clock className="w-3.5 h-3.5 shrink-0 text-white/20" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-white/30 text-xs">
          Get notified when paid plans launch →{" "}
          <a href="mailto:hello@usegrowthforge.com" className="text-[#00E676]/60 hover:text-[#00E676] transition-colors">
            hello@usegrowthforge.com
          </a>
        </p>
      </motion.div>
    </div>
  );
}
