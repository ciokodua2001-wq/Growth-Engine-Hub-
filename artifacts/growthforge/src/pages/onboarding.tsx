import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Globe, Building2, Target, Zap } from "lucide-react";

const INDUSTRIES = [
  "E-commerce", "SaaS / Tech", "Agency", "Consulting",
  "Healthcare", "Finance", "Education", "Real Estate",
  "Media / Content", "Other",
];

const GOALS = [
  "Grow organic traffic",
  "Generate more leads",
  "Improve brand awareness",
  "Automate marketing",
  "Beat competitors",
  "Launch a new product",
];

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();

  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isLoaded && !user) {
      setLocation("/sign-in");
    }
  }, [isLoaded, user]);

  if (isLoaded && !user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim() || !websiteUrl.trim()) {
      setError("Business name and website URL are required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          websiteUrl: websiteUrl.trim(),
          industry,
          primaryGoal,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      const { project } = await res.json();
      setLocation(`/projects/${project.id}/overview`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#040B14" }}>
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M20 4L10 16h7L13 28l14-16h-9l5-8z" fill="#00E676" />
          </svg>
          <span className="text-lg font-bold text-white">GrowthForge</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-white/50">
          {["Account", "Plan", "Workspace"].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              {i > 0 && <div className="w-4 h-px bg-white/20" />}
              <div className={`flex items-center gap-1.5 ${i < 2 ? "text-white/40" : "text-white"}`}>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    i < 2 ? "bg-[#00E676]/20 text-[#00E676]" : "bg-[#00E676] text-black"
                  }`}
                >
                  {i < 2 ? "✓" : "3"}
                </div>
                {step}
              </div>
            </div>
          ))}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg"
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-medium mb-4">
              <Zap className="w-3 h-3" /> Almost there!
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Set up your workspace</h1>
            <p className="text-white/50">
              Tell us about your business so GrowthForge AI can personalize your strategy.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-[#080f1e] border border-white/10 rounded-2xl p-8 flex flex-col gap-5"
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#00E676]" />
                Business Name <span className="text-[#00E676]">*</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Acme Corp"
                required
                className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#00E676]" />
                Website URL <span className="text-[#00E676]">*</span>
              </label>
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                required
                className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-white/70">Industry</label>
              <div className="grid grid-cols-2 gap-2">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => setIndustry(ind === industry ? "" : ind)}
                    className={`px-3 py-2 rounded-lg text-sm text-left transition-all ${
                      industry === ind
                        ? "bg-[#00E676]/15 border border-[#00E676]/50 text-[#00E676]"
                        : "bg-[#0d1b2e] border border-white/10 text-white/50 hover:border-white/25"
                    }`}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Target className="w-4 h-4 text-[#00E676]" />
                Primary Goal
              </label>
              <div className="grid grid-cols-1 gap-2">
                {GOALS.map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => setPrimaryGoal(goal === primaryGoal ? "" : goal)}
                    className={`px-3 py-2.5 rounded-lg text-sm text-left transition-all ${
                      primaryGoal === goal
                        ? "bg-[#00E676]/15 border border-[#00E676]/50 text-[#00E676]"
                        : "bg-[#0d1b2e] border border-white/10 text-white/50 hover:border-white/25"
                    }`}
                  >
                    {goal}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !businessName || !websiteUrl}
              className="w-full py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating workspace…</>
              ) : (
                <>Launch my workspace <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>
        </motion.div>
      </main>
    </div>
  );
}
