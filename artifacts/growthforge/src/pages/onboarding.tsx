import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  Globe,
  Building2,
  Target,
  Users,
  Zap,
  Check,
  TrendingUp,
  ShoppingCart,
  Megaphone,
  Rocket,
  Search,
  Share2,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

// ── Constants ─────────────────────────────────────────────────────────────────

const GOALS = [
  { label: "Generate Leads",    icon: TrendingUp  },
  { label: "Increase Sales",    icon: ShoppingCart },
  { label: "Brand Awareness",   icon: Megaphone   },
  { label: "Launch Product",    icon: Rocket      },
  { label: "Improve SEO",       icon: Search      },
  { label: "Grow Social Media", icon: Share2      },
];

const STEPS = [
  { number: 1, label: "Business Info"  },
  { number: 2, label: "Primary Goal"   },
  { number: 3, label: "Target Market"  },
  { number: 4, label: "Create Workspace" },
];

/** Supported locale profiles with display metadata for the market picker. */
const SUPPORTED_MARKETS = [
  { locale: "es-MX", flag: "🇲🇽", marketName: "Mexico",  languageName: "Spanish"    },
  { locale: "de-DE", flag: "🇩🇪", marketName: "Germany", languageName: "German"     },
  { locale: "fr-FR", flag: "🇫🇷", marketName: "France",  languageName: "French"     },
  { locale: "pt-BR", flag: "🇧🇷", marketName: "Brazil",  languageName: "Portuguese" },
];

// Minimum URL length before we attempt a scan
const MIN_URL_LENGTH = 5;
// Debounce delay after user stops typing (ms)
const SCAN_DEBOUNCE_MS = 700;

// ── Types ─────────────────────────────────────────────────────────────────────

type MarketScanPhase = "idle" | "scanning" | "done" | "error";

interface AnalyzeResult {
  detected: {
    locale: string;
    confidence: "tld" | "og-locale" | "html-lang" | "default";
    source: string;
  };
  suggestion: {
    locale: string | null;
    marketName: string;
    languageName: string;
    flag: string;
    isSupported: boolean;
    isDefault: boolean;
  };
}

// ── Confidence badge ───────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: AnalyzeResult["detected"]["confidence"] }) {
  const map = {
    tld:         { label: "Domain match",  color: "bg-[#00E676]/15 text-[#00E676] border-[#00E676]/30" },
    "og-locale": { label: "Meta tag",      color: "bg-blue-500/15 text-blue-400 border-blue-400/30"   },
    "html-lang": { label: "HTML lang attr",color: "bg-purple-500/15 text-purple-400 border-purple-400/30" },
    default:     { label: "No signal",     color: "bg-white/5 text-white/40 border-white/10"          },
  };
  const { label, color } = map[confidence] ?? map.default;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${color}`}>
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [step, setStep]               = useState(1);
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl]   = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  // ── Market detection state ───────────────────────────────────────────────────
  const [marketScanPhase, setMarketScanPhase] = useState<MarketScanPhase>("idle");
  const [analyzeResult, setAnalyzeResult]     = useState<AnalyzeResult | null>(null);
  const [confirmedLocale, setConfirmedLocale] = useState<string | null>(null);
  /** Whether the user has opened the manual market picker */
  const [showPicker, setShowPicker]           = useState(false);
  /** The locale currently selected in the manual picker dropdown */
  const [pickerLocale, setPickerLocale]       = useState(SUPPORTED_MARKETS[0].locale);

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScannedUrl = useRef<string>("");

  useEffect(() => {
    if (isLoaded && !user) setLocation("/sign-in");
  }, [isLoaded, user, setLocation]);

  // ── Debounced URL scan ───────────────────────────────────────────────────────
  useEffect(() => {
    // Clear any pending scan
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);

    const trimmed = websiteUrl.trim();

    // Reset detection state when URL is cleared
    if (trimmed.length < MIN_URL_LENGTH) {
      setMarketScanPhase("idle");
      setAnalyzeResult(null);
      setConfirmedLocale(null);
      setShowPicker(false);
      lastScannedUrl.current = "";
      return;
    }

    // Don't re-scan the same URL (e.g. user edits other fields)
    if (trimmed === lastScannedUrl.current) return;

    // Reset confirmed state when URL changes
    setConfirmedLocale(null);
    setShowPicker(false);
    setAnalyzeResult(null);

    scanTimerRef.current = setTimeout(async () => {
      setMarketScanPhase("scanning");
      lastScannedUrl.current = trimmed;
      try {
        const res = await fetch("/api/analyze-website", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        if (!res.ok) {
          setMarketScanPhase("error");
          return;
        }
        const data: AnalyzeResult = await res.json();
        setAnalyzeResult(data);
        setMarketScanPhase("done");

        // Auto-select the suggestion in the manual picker so it's pre-chosen
        if (data.suggestion.locale) {
          setPickerLocale(data.suggestion.locale);
        }
      } catch {
        setMarketScanPhase("error");
      }
    }, SCAN_DEBOUNCE_MS);

    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [websiteUrl]);

  if (isLoaded && !user) return null;

  // ── Navigation helpers ────────────────────────────────────────────────────────

  function canAdvanceStep1() {
    return businessName.trim().length > 0 && websiteUrl.trim().length > 0;
  }

  function goNext() {
    setError("");
    if (step === 1 && !canAdvanceStep1()) {
      setError("Business name and website URL are required.");
      return;
    }
    if (step < 4) setStep(step + 1);
    if (step === 3) handleSubmit();
  }

  function goBack() {
    if (step > 1) setStep(step - 1);
  }

  // ── Submission ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    setStep(4);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          websiteUrl: websiteUrl.trim(),
          primaryGoal,
          targetMarket,
          // Pass the user's confirmed locale so the server uses it directly
          // without running a second detector call.
          ...(confirmedLocale ? { confirmedLocale } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong. Please try again.");
        setStep(3);
        return;
      }

      const { project } = await res.json();
      setLocation(`/analysis-progress/${project.id}`);
    } catch {
      setError("Network error. Please try again.");
      setStep(3);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Market widget actions ─────────────────────────────────────────────────────

  function handleConfirmDetected() {
    if (!analyzeResult?.suggestion.locale) return;
    setConfirmedLocale(analyzeResult.suggestion.locale);
    setShowPicker(false);
  }

  function handleConfirmPicker() {
    setConfirmedLocale(pickerLocale);
    setShowPicker(false);
  }

  function handleResetMarket() {
    setConfirmedLocale(null);
    setShowPicker(false);
    // Keep analyzeResult so the card re-shows without rescanning
  }

  // ── Derived display values ────────────────────────────────────────────────────

  const confirmedMarket = confirmedLocale
    ? (SUPPORTED_MARKETS.find(m => m.locale === confirmedLocale) ??
       { locale: confirmedLocale, flag: "🌐", marketName: confirmedLocale, languageName: "" })
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#040B14" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="text-lg font-bold text-white">GrowthForge</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-white/50">
          {["Account", "Plan", "Workspace"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-4 h-px bg-white/20" />}
              <div className={`flex items-center gap-1.5 ${i < 2 ? "text-white/40" : "text-white"}`}>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    i < 2 ? "bg-[#00E676]/20 text-[#00E676]" : "bg-[#00E676] text-black"
                  }`}
                >
                  {i < 2 ? "✓" : "3"}
                </div>
                {s}
              </div>
            </div>
          ))}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-10">
          {STEPS.map((s, i) => (
            <div key={s.number} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    step > s.number
                      ? "bg-[#00E676] text-black"
                      : step === s.number
                      ? "bg-[#00E676] text-black ring-4 ring-[#00E676]/20"
                      : "bg-white/5 text-white/30 border border-white/10"
                  }`}
                >
                  {step > s.number ? <Check className="w-4 h-4" /> : s.number}
                </div>
                <span
                  className={`text-xs hidden sm:block transition-colors ${
                    step >= s.number ? "text-white/70" : "text-white/25"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-16 sm:w-24 h-px mx-2 mb-5 transition-colors ${
                    step > s.number ? "bg-[#00E676]/50" : "bg-white/10"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait">

            {/* ── Step 1 — Business Info ─────────────────────────────────── */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.25 }}
              >
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-medium mb-3">
                    <Zap className="w-3 h-3" /> Step 1 of 4
                  </div>
                  <h1 className="text-3xl font-bold text-white mb-2">Tell us about your business</h1>
                  <p className="text-white/50">We'll use this to personalize your AI marketing strategy.</p>
                </div>

                <div className="bg-[#080f1e] border border-white/10 rounded-2xl p-8 flex flex-col gap-5">
                  {/* Business Name */}
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
                      autoFocus
                      className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm"
                    />
                  </div>

                  {/* Website URL */}
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
                      className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm"
                    />
                  </div>

                  {/* ── Market Detection Widget ─────────────────────────── */}
                  <AnimatePresence mode="wait">

                    {/* Scanning */}
                    {marketScanPhase === "scanning" && (
                      <motion.div
                        key="scanning"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/3 border border-white/8 text-sm text-white/50"
                      >
                        <Loader2 className="w-4 h-4 animate-spin text-[#00E676]/60 shrink-0" />
                        Scanning your website for market signals…
                      </motion.div>
                    )}

                    {/* Confirmed */}
                    {marketScanPhase === "done" && confirmedLocale && confirmedMarket && (
                      <motion.div
                        key="confirmed"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#00E676]/8 border border-[#00E676]/25"
                      >
                        <div className="flex items-center gap-2.5 text-sm">
                          <span className="text-xl">{confirmedMarket.flag}</span>
                          <span className="text-white font-medium">
                            {confirmedMarket.marketName}
                            {confirmedMarket.languageName && (
                              <span className="text-white/40 font-normal"> · {confirmedMarket.languageName}</span>
                            )}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/30">
                            <Check className="w-2.5 h-2.5" /> Confirmed
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleResetMarket}
                          className="text-[10px] text-white/30 hover:text-white/60 transition-colors ml-2 shrink-0"
                        >
                          Change
                        </button>
                      </motion.div>
                    )}

                    {/* Detection result — not yet confirmed */}
                    {marketScanPhase === "done" && !confirmedLocale && analyzeResult && (
                      <motion.div
                        key="result"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="rounded-xl border border-white/10 bg-[#0a1628] overflow-hidden"
                      >
                        {analyzeResult.suggestion.isSupported && !analyzeResult.suggestion.isDefault ? (
                          /* ── Supported market detected ── */
                          <div>
                            <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
                              <MapPin className="w-3.5 h-3.5 text-[#00E676]" />
                              <span className="text-[11px] font-semibold text-[#00E676] uppercase tracking-wider">
                                Target market detected
                              </span>
                            </div>
                            <div className="px-4 py-4 flex flex-col gap-3">
                              <div className="flex items-center gap-3">
                                <span className="text-3xl">{analyzeResult.suggestion.flag}</span>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-white font-semibold">
                                      {analyzeResult.suggestion.marketName}
                                    </span>
                                    <span className="text-white/40 text-sm">
                                      · {analyzeResult.suggestion.languageName}
                                    </span>
                                    <ConfidenceBadge confidence={analyzeResult.detected.confidence} />
                                  </div>
                                  <p className="text-white/35 text-xs mt-0.5">
                                    GrowthForge will write all content in {analyzeResult.suggestion.languageName} for the {analyzeResult.suggestion.marketName} market.
                                  </p>
                                </div>
                              </div>

                              {showPicker ? (
                                /* Manual picker */
                                <div className="flex flex-col gap-2 pt-1">
                                  <select
                                    value={pickerLocale}
                                    onChange={(e) => setPickerLocale(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg bg-[#0d1b2e] border border-white/15 text-white text-sm focus:outline-none focus:border-[#00E676]/50"
                                  >
                                    {SUPPORTED_MARKETS.map(m => (
                                      <option key={m.locale} value={m.locale}>
                                        {m.flag}  {m.marketName} — {m.languageName}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setShowPicker(false)}
                                      className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/50 hover:bg-white/8 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleConfirmPicker}
                                      className="flex-[2] py-2 rounded-lg text-xs font-semibold bg-[#00E676] text-black hover:bg-[#14F195] transition-colors"
                                    >
                                      Confirm {SUPPORTED_MARKETS.find(m => m.locale === pickerLocale)?.marketName}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* Action row */
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowPicker(true)}
                                    className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/50 hover:bg-white/8 transition-colors"
                                  >
                                    Choose different
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleConfirmDetected}
                                    className="flex-[2] py-2 rounded-lg text-xs font-semibold bg-[#00E676] text-black hover:bg-[#14F195] transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    <Check className="w-3 h-3" />
                                    Confirm {analyzeResult.suggestion.marketName}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* ── No specific market detected / default ── */
                          <div>
                            <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
                              <Globe className="w-3.5 h-3.5 text-white/40" />
                              <span className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                                No specific market detected
                              </span>
                            </div>
                            <div className="px-4 py-4 flex flex-col gap-3">
                              <p className="text-white/40 text-xs leading-relaxed">
                                We couldn't detect a specific country market from your website. Content will default to English. You can optionally select a target market below.
                              </p>

                              {showPicker ? (
                                <div className="flex flex-col gap-2">
                                  <select
                                    value={pickerLocale}
                                    onChange={(e) => setPickerLocale(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg bg-[#0d1b2e] border border-white/15 text-white text-sm focus:outline-none focus:border-[#00E676]/50"
                                  >
                                    {SUPPORTED_MARKETS.map(m => (
                                      <option key={m.locale} value={m.locale}>
                                        {m.flag}  {m.marketName} — {m.languageName}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setShowPicker(false)}
                                      className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/50 hover:bg-white/8 transition-colors"
                                    >
                                      Skip
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleConfirmPicker}
                                      className="flex-[2] py-2 rounded-lg text-xs font-semibold bg-[#00E676] text-black hover:bg-[#14F195] transition-colors"
                                    >
                                      Use {SUPPORTED_MARKETS.find(m => m.locale === pickerLocale)?.marketName}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setShowPicker(true)}
                                  className="w-full py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-white/50 hover:bg-white/8 transition-colors"
                                >
                                  Choose a target market (optional)
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* Scan error — offer manual picker */}
                    {marketScanPhase === "error" && !confirmedLocale && (
                      <motion.div
                        key="scan-error"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="px-4 py-3 rounded-xl bg-white/3 border border-white/8 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white/40">
                            Couldn't reach your site to detect the market.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              lastScannedUrl.current = "";
                              setWebsiteUrl(w => w + " ");
                              setTimeout(() => setWebsiteUrl(w => w.trim()), 10);
                            }}
                            className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> Retry
                          </button>
                        </div>
                        {showPicker ? (
                          <div className="flex gap-2">
                            <select
                              value={pickerLocale}
                              onChange={(e) => setPickerLocale(e.target.value)}
                              className="flex-1 px-3 py-2 rounded-lg bg-[#0d1b2e] border border-white/15 text-white text-xs focus:outline-none focus:border-[#00E676]/50"
                            >
                              {SUPPORTED_MARKETS.map(m => (
                                <option key={m.locale} value={m.locale}>
                                  {m.flag}  {m.marketName}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={handleConfirmPicker}
                              className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#00E676] text-black hover:bg-[#14F195] transition-colors"
                            >
                              Use
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowPicker(true)}
                            className="text-[11px] text-[#00E676]/70 hover:text-[#00E676] transition-colors text-left"
                          >
                            Manually select a target market →
                          </button>
                        )}
                      </motion.div>
                    )}

                    {/* Idle hint */}
                    {marketScanPhase === "idle" && (
                      <motion.p
                        key="idle-hint"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-white/30 text-xs -mt-1"
                      >
                        Our AI will read your website and automatically detect your industry, products, and target market.
                      </motion.p>
                    )}

                  </AnimatePresence>
                  {/* ── End Market Detection Widget ─────────────────────── */}

                  {error && (
                    <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!canAdvanceStep1()}
                    className="w-full py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
                  >
                    Continue <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2 — Primary Goal ─────────────────────────────────── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.25 }}
              >
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-medium mb-3">
                    <Target className="w-3 h-3" /> Step 2 of 4
                  </div>
                  <h1 className="text-3xl font-bold text-white mb-2">What's your primary goal?</h1>
                  <p className="text-white/50">Forge AI will prioritize your marketing around this.</p>
                </div>

                <div className="bg-[#080f1e] border border-white/10 rounded-2xl p-8 flex flex-col gap-5">
                  <div className="grid grid-cols-2 gap-3">
                    {GOALS.map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setPrimaryGoal(label === primaryGoal ? "" : label)}
                        className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium text-left transition-all ${
                          primaryGoal === label
                            ? "bg-[#00E676]/15 border-2 border-[#00E676]/60 text-[#00E676]"
                            : "bg-[#0d1b2e] border border-white/10 text-white/60 hover:border-white/25 hover:text-white/80"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-3 mt-1">
                    <button
                      type="button"
                      onClick={goBack}
                      className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-white/70 hover:bg-white/8 transition-all flex items-center justify-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      type="button"
                      onClick={goNext}
                      className="flex-[2] py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all flex items-center justify-center gap-2"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Step 3 — Target Market ─────────────────────────────────── */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.25 }}
              >
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-xs font-medium mb-3">
                    <Users className="w-3 h-3" /> Step 3 of 4
                  </div>
                  <h1 className="text-3xl font-bold text-white mb-2">Who's your ideal customer?</h1>
                  <p className="text-white/50">Optional — helps Forge AI build more targeted campaigns.</p>
                </div>

                <div className="bg-[#080f1e] border border-white/10 rounded-2xl p-8 flex flex-col gap-5">
                  {/* Confirmed locale carry-through indicator */}
                  {confirmedMarket && (
                    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#00E676]/6 border border-[#00E676]/20 text-sm">
                      <span className="text-lg">{confirmedMarket.flag}</span>
                      <span className="text-white/60 text-xs">
                        Content will be generated in <span className="text-white font-medium">{confirmedMarket.marketName}</span> — {confirmedMarket.languageName}.
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/70">Target Market Description</label>
                    <textarea
                      value={targetMarket}
                      onChange={(e) => setTargetMarket(e.target.value)}
                      placeholder="e.g. Small business owners aged 30-50 in North America who want to automate their marketing without hiring an agency…"
                      rows={4}
                      className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-none"
                    />
                    <p className="text-white/30 text-xs">
                      Describe demographics, pain points, or buying behaviour. Leave blank to skip.
                    </p>
                  </div>

                  {error && (
                    <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 mt-1">
                    <button
                      type="button"
                      onClick={goBack}
                      className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-white/70 hover:bg-white/8 transition-all flex items-center justify-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      type="button"
                      onClick={goNext}
                      className="flex-[2] py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all flex items-center justify-center gap-2"
                    >
                      Launch My Workspace <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Step 4 — Creating workspace ───────────────────────────── */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="text-center"
              >
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#00E676]/10 border border-[#00E676]/30 mb-6">
                  <Loader2 className="w-8 h-8 text-[#00E676] animate-spin" />
                </div>
                <h1 className="text-3xl font-bold text-white mb-3">Creating your workspace…</h1>
                <p className="text-white/50 mb-6">
                  Setting up your AI marketing OS. This will only take a moment.
                </p>
                <div className="flex flex-col items-center gap-3 text-sm text-white/40">
                  {["Creating project", "Configuring AI models", "Preparing your dashboard"].map((t, i) => (
                    <motion.div
                      key={t}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.4 }}
                      className="flex items-center gap-2"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00E676]/50" />
                      {t}
                    </motion.div>
                  ))}
                </div>
                {error && (
                  <div className="mt-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
