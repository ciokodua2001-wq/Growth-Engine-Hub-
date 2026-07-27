import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Check, Sparkles, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/api";
import { useUser } from "@clerk/clerk-react";

export default function Pricing() {
  const [, navigate] = useLocation();
  const { isSignedIn } = useUser();
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    if (!isSignedIn) {
      navigate("/");
      return;
    }
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/z/subscription/checkout", { method: "POST" });
      if (url) window.location.href = url;
    } finally {
      setLoading(false);
    }
  };

  const freeFeatures = [
    "10 questions per session",
    "All subjects supported",
    "Curriculum-aligned AI",
    "Voice playback",
  ];

  const paidFeatures = [
    "Configurable monthly question limit",
    "All subjects supported",
    "Curriculum-aligned AI",
    "Voice playback",
    "Priority response speed",
    "Session history",
  ];

  return (
    <div className="min-h-screen bg-[#080B14] text-white">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate(-1 as unknown as string)}
          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-sm">
          Z
        </div>
        <span className="font-semibold">Pricing</span>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">Simple pricing</h1>
          <p className="text-white/40">Start free. Upgrade when you need more.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Free */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl bg-white/[0.03] border border-white/8"
          >
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-white/40" />
              <span className="text-sm text-white/50 font-medium uppercase tracking-wider">Free</span>
            </div>
            <div className="text-4xl font-bold text-white mt-3 mb-1">$0</div>
            <div className="text-sm text-white/40 mb-6">forever</div>
            <ul className="space-y-2.5 mb-6">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-white/60">
                  <Check className="w-4 h-4 text-white/30 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigate("/")}
              className="w-full px-4 py-3 border border-white/10 rounded-xl text-sm text-white/60 hover:text-white hover:border-white/20 transition-colors"
            >
              Continue free
            </button>
          </motion.div>

          {/* Paid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/60 to-violet-950/60 border border-indigo-600/30 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span className="text-sm text-indigo-300 font-medium uppercase tracking-wider">Unlimited</span>
              </div>
              <div className="text-4xl font-bold text-white mt-3 mb-1">
                $9.99
                <span className="text-xl font-normal text-white/40">/mo</span>
              </div>
              <div className="text-sm text-white/40 mb-6">billed monthly · cancel anytime</div>
              <ul className="space-y-2.5 mb-6">
                {paidFeatures.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-indigo-100/80">
                    <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-indigo-900/40"
              >
                {loading ? "Loading…" : "Get unlimited access"}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
