import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Globe, Loader2, Check, AlertCircle, Sparkles, Languages } from "lucide-react";

const LOCALE_OPTIONS = [
  { value: "",      flag: "🌐", label: "English (default)" },
  { value: "es-MX", flag: "🇲🇽", label: "Spanish — Mexico" },
  { value: "de-DE", flag: "🇩🇪", label: "German — Germany" },
  { value: "pt-BR", flag: "🇧🇷", label: "Portuguese — Brazil" },
];

interface GenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  defaultWebsiteUrl?: string;
  instructionsPlaceholder?: string;
  processingSteps: string[];
  onSubmit: (websiteUrl: string, instructions: string, locale: string) => Promise<void>;
  ctaLabel?: string;
}

type Phase = "form" | "loading" | "success" | "error";

const STEP_DURATION = 1100;

const DEFAULT_PLACEHOLDER = `Examples:
• Focus on SEO
• Analyze competitors
• Generate LinkedIn content
• Create email campaign`;

export default function GenerateModal({
  isOpen,
  onClose,
  title,
  subtitle,
  defaultWebsiteUrl = "",
  instructionsPlaceholder,
  processingSteps,
  onSubmit,
  ctaLabel = "Generate",
}: GenerateModalProps) {
  const [phase, setPhase] = useState<Phase>("form");
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsiteUrl);
  const [instructions, setInstructions] = useState("");
  const [locale, setLocale] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen) {
      setPhase("form");
      setWebsiteUrl(defaultWebsiteUrl);
      setInstructions("");
      setLocale("");
      setCurrentStep(0);
      setErrorMsg("");
    }
  }, [isOpen, defaultWebsiteUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteUrl.trim()) return;

    setPhase("loading");
    setCurrentStep(0);

    let stepIdx = 0;
    const interval = setInterval(() => {
      stepIdx++;
      if (stepIdx < processingSteps.length) {
        setCurrentStep(stepIdx);
      }
    }, STEP_DURATION);

    try {
      await Promise.all([
        onSubmit(websiteUrl.trim(), instructions, locale),
        new Promise<void>((r) => setTimeout(r, processingSteps.length * STEP_DURATION)),
      ]);
      clearInterval(interval);
      setCurrentStep(processingSteps.length - 1);
      setPhase("success");
      setTimeout(onClose, 1800);
    } catch (err: unknown) {
      clearInterval(interval);
      setPhase("error");
      let msg = "Generation failed. Please try again.";
      if (err instanceof Error) {
        // Strip the "HTTP NNN StatusText: " prefix that ApiError prepends
        msg = err.message.replace(/^HTTP \d+[^:]*:\s*/i, "").trim() || msg;
      }
      setErrorMsg(msg);
    }
  };

  const canClose = phase !== "loading";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && canClose) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
            className="w-full max-w-md bg-card border border-border rounded-2xl overflow-hidden shadow-2xl shadow-black/40"
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <div>
                <h2 className="font-black text-lg tracking-tight">{title}</h2>
                {subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
                )}
              </div>
              {canClose && (
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {phase === "form" && (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Website URL
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://yourbusiness.com"
                      className="w-full bg-secondary border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Instructions
                    </label>
                    <span className="text-[10px] text-muted-foreground/50 font-normal">Optional</span>
                  </div>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder={instructionsPlaceholder ?? DEFAULT_PLACEHOLDER}
                    rows={4}
                    className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none leading-relaxed"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Languages className="h-3 w-3 text-muted-foreground" />
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Output Language
                    </label>
                  </div>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                    className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {LOCALE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.flag}  {opt.label}
                      </option>
                    ))}
                  </select>
                  {locale && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1 pl-1">
                      All generated content will be written in {LOCALE_OPTIONS.find(o => o.value === locale)?.label.split(" — ")[0]}, using regional tone, idioms, and SEO patterns for that market.
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-xl text-sm transition-colors shadow-lg shadow-primary/20"
                >
                  <Sparkles className="h-4 w-4" />
                  {ctaLabel}
                </button>
              </form>
            )}

            {phase === "loading" && (
              <div className="p-6">
                <div className="space-y-3 mb-5">
                  {processingSteps.map((step, i) => {
                    const isDone = i < currentStep;
                    const isRunning = i === currentStep;
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{
                          opacity: isDone || isRunning ? 1 : 0.25,
                          x: 0,
                        }}
                        transition={{ delay: i * 0.08, duration: 0.3 }}
                        className="flex items-center gap-3"
                      >
                        <div className="shrink-0 h-5 w-5 flex items-center justify-center">
                          {isDone ? (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: "spring", bounce: 0.5 }}
                              className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center"
                            >
                              <Check className="h-3 w-3 text-primary" />
                            </motion.div>
                          ) : isRunning ? (
                            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                              <Loader2 className="h-3 w-3 text-primary animate-spin" />
                            </div>
                          ) : (
                            <div className="h-5 w-5 rounded-full border border-border/40" />
                          )}
                        </div>
                        <span
                          className={`text-sm ${
                            isDone
                              ? "text-foreground/80"
                              : isRunning
                              ? "text-foreground font-medium"
                              : "text-muted-foreground/40"
                          }`}
                        >
                          {step}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                  <motion.div
                    animate={{
                      width: `${((currentStep + 1) / processingSteps.length) * 100}%`,
                    }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="h-full bg-primary rounded-full"
                    style={{ boxShadow: "0 0 8px var(--color-primary)" }}
                  />
                </div>
              </div>
            )}

            {phase === "success" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-8 flex flex-col items-center text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5, delay: 0.1 }}
                  className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mb-4"
                >
                  <Check className="h-8 w-8 text-primary" />
                </motion.div>
                <h3 className="font-black text-xl mb-1">All done!</h3>
                <p className="text-sm text-muted-foreground">Content saved to your project.</p>
              </motion.div>
            )}

            {phase === "error" && (
              <div className="p-6 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-destructive/20 flex items-center justify-center mb-4">
                  <AlertCircle className="h-6 w-6 text-rose-400" />
                </div>
                <h3 className="font-bold mb-1">Something went wrong</h3>
                <p className="text-xs text-muted-foreground mb-5 max-w-xs">{errorMsg}</p>
                <button
                  onClick={() => setPhase("form")}
                  className="bg-secondary hover:bg-secondary/80 text-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
