import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Zap, AlertTriangle } from "lucide-react";
import {
  getProject,
  analyzeWebsite,
  discoverCompetitors,
  generatePersonas,
  generateMarketingStrategy,
} from "@workspace/api-client-react";

const ANALYSIS_STEPS = [
  {
    label: "Analyzing your website",
    detail: "Reading your live pages and extracting real business intelligence…",
  },
  {
    label: "Identifying competitors",
    detail: "Finding real companies that compete with you and mapping the landscape…",
  },
  {
    label: "Creating customer profiles",
    detail: "Building detailed personas grounded in your actual business…",
  },
  {
    label: "Building marketing strategy",
    detail: "Crafting a tailored go-to-market plan for your goals…",
  },
];

export default function AnalysisProgressPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);

  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [businessDescription, setBusinessDescription] = useState("");
  const [showDescriptionForm, setShowDescriptionForm] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!projectId || Number.isNaN(projectId)) return;
    let mounted = true;
    startedRef.current = true;

    async function run() {
      setError(null);
      try {
        setActiveStep(0);
        const project = await getProject(projectId);
        await analyzeWebsite(projectId, {
          websiteUrl: project.websiteUrl,
          ...(businessDescription ? { businessDescription } : {}),
        });
        if (!mounted) return;
        setCompletedSteps((prev) => [...prev, 0]);

        setActiveStep(1);
        await discoverCompetitors(projectId);
        if (!mounted) return;
        setCompletedSteps((prev) => [...prev, 1]);

        setActiveStep(2);
        await generatePersonas(projectId);
        if (!mounted) return;
        setCompletedSteps((prev) => [...prev, 2]);

        setActiveStep(3);
        await generateMarketingStrategy(projectId);
        if (!mounted) return;
        setCompletedSteps((prev) => [...prev, 3]);

        setDone(true);
        await new Promise((r) => setTimeout(r, 1200));
        if (mounted) setLocation(`/projects/${projectId}/overview`);
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        setError(msg);
        // If the error is a website scraping failure, offer the manual description form
        if (
          msg.includes("readable text") ||
          msg.includes("Could not reach") ||
          msg.includes("network error") ||
          msg.includes("HTTP 4")
        ) {
          setShowDescriptionForm(true);
        }
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [projectId, setLocation, retryToken]);

  const progress = done
    ? 100
    : Math.round(((completedSteps.length + (error ? 0 : 0.5)) / ANALYSIS_STEPS.length) * 100);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "#040B14" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mb-12">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M20 4L10 16h7L13 28l14-16h-9l5-8z" fill="#00E676" />
        </svg>
        <span className="text-xl font-bold text-white">GrowthForge</span>
      </div>

      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium mb-4 ${
              error
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676]"
            }`}
          >
            {error ? <AlertTriangle className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
            {error ? "Analysis failed" : done ? "Analysis complete!" : "AI analysis running…"}
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            {error
              ? "We couldn't finish your analysis"
              : done
              ? "Your marketing OS is ready"
              : "Analyzing your business"}
          </h1>
          <p className="text-white/50">
            {error
              ? error
              : done
              ? "Everything's set up. Taking you to your dashboard…"
              : "Forge AI is reading your real website and building your personalized marketing strategy."}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-white/40 mb-2">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: error
                  ? "linear-gradient(90deg, #ef4444, #f97316)"
                  : "linear-gradient(90deg, #00E676, #00D4FF)",
              }}
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-3">
          {ANALYSIS_STEPS.map((step, i) => {
            const isComplete = completedSteps.includes(i);
            const isFailed = !!error && activeStep === i && !isComplete;
            const isActive = activeStep === i && !isComplete && !error;
            const isPending = !isComplete && !isActive && !isFailed;

            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-start gap-4 px-4 py-3.5 rounded-xl border transition-all duration-500 ${
                  isComplete
                    ? "bg-[#00E676]/8 border-[#00E676]/25"
                    : isFailed
                    ? "bg-red-500/8 border-red-500/25"
                    : isActive
                    ? "bg-white/4 border-white/15"
                    : "bg-transparent border-transparent"
                }`}
              >
                {/* Icon */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                    isComplete
                      ? "bg-[#00E676] text-black"
                      : isFailed
                      ? "bg-red-500/20 border-2 border-red-500/60"
                      : isActive
                      ? "bg-white/10 border-2 border-[#00E676]/60"
                      : "bg-white/5 border border-white/10"
                  }`}
                >
                  {isComplete ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : isFailed ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  ) : isActive ? (
                    <motion.div
                      className="w-2 h-2 rounded-full bg-[#00E676]"
                      animate={{ scale: [1, 1.4, 1] }}
                      transition={{ repeat: Infinity, duration: 1.2 }}
                    />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                  )}
                </div>

                {/* Text */}
                <div>
                  <p
                    className={`text-sm font-medium transition-colors ${
                      isComplete
                        ? "text-[#00E676]"
                        : isFailed
                        ? "text-red-400"
                        : isActive
                        ? "text-white"
                        : "text-white/30"
                    }`}
                  >
                    {step.label}
                  </p>
                  <AnimatePresence>
                    {(isActive || isFailed) && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-xs text-white/40 mt-0.5"
                      >
                        {step.detail}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Timing badge */}
                {isActive && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="ml-auto text-[10px] text-white/25 shrink-0"
                  >
                    running…
                  </motion.span>
                )}
                {isComplete && (
                  <span className="ml-auto text-[10px] text-[#00E676]/60 shrink-0">done</span>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Done state */}
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 text-center"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 text-[#00E676] text-sm font-medium">
                <Zap className="w-4 h-4" />
                Launching your dashboard…
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error state */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 flex flex-col gap-3"
            >
              {showDescriptionForm ? (
                <>
                  <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
                    <p className="text-xs text-yellow-400 font-medium mb-1">
                      We couldn't read your website automatically
                    </p>
                    <p className="text-xs text-white/50 mb-3">
                      Describe your business below and we'll use that instead — what you do, who you serve, and what makes you different.
                    </p>
                    <textarea
                      value={businessDescription}
                      onChange={(e) => setBusinessDescription(e.target.value)}
                      placeholder="e.g. We're a B2B SaaS company that helps logistics teams automate their shipping workflows. We serve mid-market e-commerce brands in the US and reduce manual dispatch time by 80%..."
                      rows={5}
                      className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-[#00E676]/40 resize-none"
                    />
                    <button
                      type="button"
                      disabled={businessDescription.trim().length < 30}
                      onClick={() => {
                        setCompletedSteps([]);
                        setActiveStep(0);
                        setDone(false);
                        setShowDescriptionForm(false);
                        setRetryToken((t) => t + 1);
                      }}
                      className="mt-2 w-full px-5 py-2.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all disabled:opacity-40"
                    >
                      Analyse with my description
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCompletedSteps([]);
                      setActiveStep(0);
                      setDone(false);
                      setShowDescriptionForm(false);
                      setBusinessDescription("");
                      setRetryToken((t) => t + 1);
                    }}
                    className="text-xs text-white/40 hover:text-white/60 transition-colors underline text-center"
                  >
                    Try fetching website again
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCompletedSteps([]);
                    setActiveStep(0);
                    setDone(false);
                    setRetryToken((t) => t + 1);
                  }}
                  className="px-5 py-3 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all"
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocation(`/projects/${projectId}/overview`)}
                className="text-xs text-white/40 hover:text-white/60 transition-colors underline text-center"
              >
                Skip to dashboard
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
