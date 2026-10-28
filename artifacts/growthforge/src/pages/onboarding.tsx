import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  Globe,
  Instagram,
  Facebook,
  Youtube,
  Linkedin,
  Music2,
  PenLine,
  Building2,
  User,
  Users,
  Check,
  AlertCircle,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { getClientRegion } from "@/lib/region";

// ── Types ─────────────────────────────────────────────────────────────────────

type OperatingModel = "business" | "creator" | "hybrid";
type SourceType =
  | "website"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "manual";

const MODELS: { id: OperatingModel; label: string; desc: string; icon: typeof Building2 }[] = [
  { id: "business", label: "I run a business", desc: "Products, services, customers, and growth.", icon: Building2 },
  { id: "creator", label: "I'm a content creator or influencer", desc: "Audience, niche, content, and monetization.", icon: User },
  { id: "hybrid", label: "I'm both", desc: "A creator running a business (or a business with a creator presence).", icon: Users },
];

const SOURCES: { id: SourceType; label: string; hint: string; icon: typeof Globe; placeholder: string }[] = [
  { id: "website", label: "Website", hint: "We'll analyze your site automatically.", icon: Globe, placeholder: "https://yourbusiness.com" },
  { id: "instagram", label: "Instagram", hint: "Profile handle + a short description.", icon: Instagram, placeholder: "instagram.com/yourhandle" },
  { id: "facebook", label: "Facebook", hint: "Page URL + a short description.", icon: Facebook, placeholder: "facebook.com/yourpage" },
  { id: "tiktok", label: "TikTok", hint: "Profile URL + a short description.", icon: Music2, placeholder: "tiktok.com/@yourhandle" },
  { id: "youtube", label: "YouTube", hint: "Channel URL + a short description.", icon: Youtube, placeholder: "youtube.com/@yourchannel" },
  { id: "linkedin", label: "LinkedIn", hint: "Company/profile URL + a short description.", icon: Linkedin, placeholder: "linkedin.com/company/yourcompany" },
  { id: "manual", label: "No website or public page", hint: "Describe your business or content in your own words.", icon: PenLine, placeholder: "" },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const region = getClientRegion();
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useAuth();

  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Step 1 - operating model
  const [operatingModel, setOperatingModel] = useState<OperatingModel | null>(null);

  // Step 2 - source
  const [sourceType, setSourceType] = useState<SourceType | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [declaredDescription, setDeclaredDescription] = useState("");

  // Step 3 - model-specific details
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [productsServices, setProductsServices] = useState("");
  const [targetCustomers, setTargetCustomers] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [contentNiche, setContentNiche] = useState("");
  const [audienceDescription, setAudienceDescription] = useState("");
  const [contentThemes, setContentThemes] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [currentGoals, setCurrentGoals] = useState("");
  const [selfReportedStats, setSelfReportedStats] = useState("");

  useEffect(() => {
    if (isLoaded && !user) setLocation("/sign-in");
  }, [isLoaded, user, setLocation]);

  if (isLoaded && !user) return null;

  const isBusiness = operatingModel === "business" || operatingModel === "hybrid";
  const isCreator = operatingModel === "creator" || operatingModel === "hybrid";
  const sourceIsWebsite = sourceType === "website";

  // ── Step validation ──────────────────────────────────────────────────────────
  function canAdvanceStep1() {
    return operatingModel !== null;
  }

  function canAdvanceStep2() {
    if (!sourceType) return false;
    if (sourceIsWebsite) return websiteUrl.trim().length > 0;
    // social / manual: need a handle OR a description
    return sourceUrl.trim().length > 0 || declaredDescription.trim().length > 0;
  }

  function canAdvanceStep3() {
    if (isCreator && creatorName.trim().length === 0) return false;
    if (isBusiness && businessName.trim().length === 0 && creatorName.trim().length === 0) return false;
    return true;
  }

  function goNext() {
    setError("");
    if (step === 1 && !canAdvanceStep1()) { setError(region === "nigeria" ? "Select the option that best describes your business or creator setup." : "Select the option that best describes you."); return; }
    if (step === 2 && !canAdvanceStep2()) {
      setError(sourceIsWebsite ? "Enter your website URL." : (region === "nigeria" ? "Enter a public profile URL or a short business description. If customers mainly contact you by phone or WhatsApp, describe that in the business details instead of selecting it as a channel." : "Enter a profile URL or a short description."));
      return;
    }
    if (step === 3 && !canAdvanceStep3()) { setError(region === "nigeria" ? "Enter your business name, creator name, or brand name." : "A name is required."); return; }
    if (step < 4) setStep(step + 1);
  }

  function goBack() {
    setError("");
    if (step > 1) setStep(step - 1);
  }

  // ── Submission ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    setStep(5);

    const businessNameFinal = (isBusiness ? businessName : creatorName).trim()
      || creatorName.trim()
      || businessName.trim();

    const toList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

    const payload: Record<string, unknown> = {
      businessName: businessNameFinal,
      operatingModel: operatingModel ?? "business",
      sourceType: sourceType ?? "manual",
      ...(sourceIsWebsite ? { websiteUrl: websiteUrl.trim() } : {}),
      ...(!sourceIsWebsite && sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      ...(declaredDescription.trim() ? { declaredDescription: declaredDescription.trim() } : {}),
      ...(isBusiness && category.trim() ? { primaryGoal: category.trim() } : {}),
      ...(isBusiness && targetCustomers.trim() ? { targetMarket: targetCustomers.trim() } : {}),
      ...(isCreator
        ? {
            creatorProfile: {
              creatorName: creatorName.trim() || undefined,
              channelName: channelName.trim() || undefined,
              contentNiche: contentNiche.trim() || undefined,
              audienceDescription: audienceDescription.trim() || undefined,
              contentThemes: toList(contentThemes),
              brandVoice: brandVoice.trim() || undefined,
              currentGoals: currentGoals.trim() || undefined,
              selfReportedStats: selfReportedStats.trim() ? { note: selfReportedStats.trim() } : undefined,
            },
          }
        : {}),
    };

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? (region === "nigeria" ? "Something went wrong while setting up your workspace. Please try again." : "Something went wrong. Please try again."));
        setStep(4);
        return;
      }
      const { project } = await res.json();
      setLocation(`/analysis-progress/${project.id}`);
    } catch {
      setError(region === "nigeria" ? "Network error while setting up your workspace. Please try again." : "Network error. Please try again.");
      setStep(4);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirmation summary ─────────────────────────────────────────────────────
  const nameLabel = isBusiness ? businessName : creatorName;
  const provided: { k: string; v: string }[] = [
    { k: "Operating model", v: operatingModel ? MODELS.find((m) => m.id === operatingModel)?.label ?? operatingModel : "" },
    { k: "Source", v: sourceType ? SOURCES.find((s) => s.id === sourceType)?.label ?? sourceType : "" },
    ...(sourceIsWebsite && websiteUrl.trim() ? [{ k: "Website", v: websiteUrl.trim() }] : []),
    ...(!sourceIsWebsite && sourceUrl.trim() ? [{ k: "Profile", v: sourceUrl.trim() }] : []),
    ...(declaredDescription.trim() ? [{ k: "Description", v: declaredDescription.trim() }] : []),
    ...(isBusiness && businessName.trim() ? [{ k: "Business name", v: businessName.trim() }] : []),
    ...(isCreator && creatorName.trim() ? [{ k: "Creator", v: creatorName.trim() }] : []),
    ...(contentNiche.trim() ? [{ k: "Niche", v: contentNiche.trim() }] : []),
    ...(audienceDescription.trim() ? [{ k: "Audience", v: audienceDescription.trim() }] : []),
    ...(targetCustomers.trim() ? [{ k: "Target customers", v: targetCustomers.trim() }] : []),
    ...(productsServices.trim() ? [{ k: "Products/services", v: productsServices.trim() }] : []),
    ...(currentGoals.trim() ? [{ k: "Goals", v: currentGoals.trim() }] : []),
  ];

  const missing: string[] = [];
  if (isBusiness && !productsServices.trim()) missing.push("products / services");
  if (isBusiness && !targetCustomers.trim()) missing.push("target customers");
  if (isCreator && !audienceDescription.trim()) missing.push("audience description");
  if (isCreator && !contentNiche.trim()) missing.push("content niche");
  if (!declaredDescription.trim() && !sourceIsWebsite) missing.push("a longer manual description (recommended)");

  const analysisLabel =
    operatingModel === "creator"
      ? "creator intelligence (niche, audience, creator positioning, growth opportunities)"
      : operatingModel === "hybrid"
      ? "creator + business intelligence (audience and commercial opportunity)"
      : "business intelligence (industry, ICP, value proposition, growth opportunities)";

  return (
    <div className="min-h-screen bg-[#050a12] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto w-full">
        <Logo />
        <span className="text-xs text-white/30">{step <= 4 ? `Step ${step} of 4` : "Creating..."}</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            {/* ── Step 1 - Operating model ─────────────────────────────────── */}
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                <h1 className="text-3xl font-bold mb-2">What best describes you?</h1>
                <p className="text-white/40 mb-8">We tailor everything - analysis, content, and strategy - to how you work.</p>
                <div className="space-y-3">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setOperatingModel(m.id)}
                      className={`w-full flex items-center gap-4 p-5 rounded-2xl border text-left transition-all ${
                        operatingModel === m.id
                          ? "border-[#00E676]/60 bg-[#00E676]/5"
                          : "border-white/10 bg-white/[0.02] hover:border-white/20"
                      }`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${operatingModel === m.id ? "bg-[#00E676]/15 text-[#00E676]" : "bg-white/5 text-white/50"}`}>
                        <m.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold">{m.label}</div>
                        <div className="text-sm text-white/40">{m.desc}</div>
                      </div>
                      {operatingModel === m.id && <Check className="w-5 h-5 text-[#00E676]" />}
                    </button>
                  ))}
                </div>
                {error && <ErrorBox msg={error} />}
                <NavRow onBack={undefined} onNext={goNext} nextLabel="Continue" />
              </motion.div>
            )}

            {/* ── Step 2 - Source ─────────────────────────────────────────── */}
            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                <h1 className="text-3xl font-bold mb-2">{region === "nigeria" ? "Where should GrowthForge Nigeria start?" : "Where can we learn about you?"}</h1>
                <p className="text-white/40 mb-8">
                  {region === "nigeria" ? "Pick the channel Nigerian customers know you from best. GrowthForge analyzes your website automatically; for Instagram, Facebook, TikTok and other social profiles, it uses the description you provide." : <>Pick your main online presence. GrowthForge analyzes your <b>website</b> automatically; for social platforms it uses the description you provide (it does not read private accounts).</>}
                </p>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {SOURCES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSourceType(s.id)}
                      className={`flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all ${
                        sourceType === s.id ? "border-[#00E676]/60 bg-[#00E676]/5" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                      }`}
                    >
                      <s.icon className={`w-5 h-5 ${sourceType === s.id ? "text-[#00E676]" : "text-white/40"}`} />
                      <span className="font-medium text-sm">{s.label}</span>
                      <span className="text-xs text-white/35 leading-snug">{s.hint}</span>
                    </button>
                  ))}
                </div>

                {sourceType && (
                  <div className="space-y-4">
                    {sourceIsWebsite && (
                      <Field label="Website URL" placeholder={SOURCES.find((s) => s.id === "website")!.placeholder} value={websiteUrl} onChange={setWebsiteUrl} />
                    )}
                    {sourceType !== "manual" && !sourceIsWebsite && (
                      <Field label="Profile URL or handle" placeholder={SOURCES.find((s) => s.id === sourceType)!.placeholder} value={sourceUrl} onChange={setSourceUrl} />
                    )}
                    <div>
                      <label className="block text-sm font-medium mb-1.5">A short description (recommended)</label>
                      <textarea
                        value={declaredDescription}
                        onChange={(e) => setDeclaredDescription(e.target.value)}
                        rows={4}
                        placeholder={
                          sourceIsWebsite
                            ? "Optional. Used only if your website can't be reached."
                            : "Describe what you do, who you serve, and what you're known for."
                        }
                        className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-none"
                      />
                    </div>
                  </div>
                )}

                {error && <ErrorBox msg={error} />}
                <NavRow onBack={goBack} onNext={goNext} nextLabel="Continue" />
              </motion.div>
            )}

            {/* ── Step 3 - Details ────────────────────────────────────────── */}
            {step === 3 && (
              <motion.div key="s3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                <h1 className="text-3xl font-bold mb-2">Tell us a little more</h1>
                <p className="text-white/40 mb-8">Everything is optional except a name - more detail means sharper analysis.</p>

                {isBusiness && (
                  <div className="space-y-4 mb-6">
                    <Field label="Business name" placeholder="e.g. Amaka's Catering" value={businessName} onChange={setBusinessName} />
                    <Field label="Category" placeholder="e.g. Food & catering" value={category} onChange={setCategory} />
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Products / services</label>
                      <textarea value={productsServices} onChange={(e) => setProductsServices(e.target.value)} rows={2} placeholder="What do you sell or offer?" className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Target customers</label>
                      <textarea value={targetCustomers} onChange={(e) => setTargetCustomers(e.target.value)} rows={2} placeholder="Who do you serve?" className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-none" />
                    </div>
                  </div>
                )}

                {isCreator && (
                  <div className="space-y-4 mb-6">
                    <Field label="Creator / channel name" placeholder="e.g. @amaka.eats" value={creatorName} onChange={setCreatorName} />
                    <Field label="Channel name (optional)" placeholder="e.g. Amaka Eats" value={channelName} onChange={setChannelName} />
                    <Field label="Content niche" placeholder="e.g. Nigerian food, lifestyle, comedy" value={contentNiche} onChange={setContentNiche} />
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Audience</label>
                      <textarea value={audienceDescription} onChange={(e) => setAudienceDescription(e.target.value)} rows={2} placeholder="Who watches or follows you?" className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-none" />
                    </div>
                    <Field label="Content themes (comma-separated)" placeholder="e.g. recipes, restaurant reviews" value={contentThemes} onChange={setContentThemes} />
                    <Field label="Brand voice" placeholder="e.g. warm, funny, educational" value={brandVoice} onChange={setBrandVoice} />
                    <Field label="Goals" placeholder="e.g. grow audience, land brand deals" value={currentGoals} onChange={setCurrentGoals} />
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Self-reported stats (optional)</label>
                      <textarea value={selfReportedStats} onChange={(e) => setSelfReportedStats(e.target.value)} rows={2} placeholder="e.g. ~10k followers on Instagram (you provide this; it is not verified)" className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-none" />
                    </div>
                  </div>
                )}

                {error && <ErrorBox msg={error} />}
                <NavRow onBack={goBack} onNext={goNext} nextLabel="Review" />
              </motion.div>
            )}

            {/* ── Step 4 - Confirmation ───────────────────────────────────── */}
            {step === 4 && (
              <motion.div key="s4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                <h1 className="text-3xl font-bold mb-2">Confirm your workspace</h1>
                <p className="text-white/40 mb-6">Here's what we'll use to build your workspace.</p>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 mb-4">
                  <div className="text-sm font-semibold text-white/70 mb-3">What you provided</div>
                  <dl className="space-y-2">
                    {provided.map((r) => (
                      <div key={r.k} className="flex gap-3 text-sm">
                        <dt className="text-white/35 w-36 shrink-0">{r.k}</dt>
                        <dd className="text-white/80 break-words">{r.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 mb-4">
                  <div className="text-sm font-semibold text-white/70 mb-2">Retrieved automatically</div>
                  <p className="text-sm text-white/50">
                    {sourceIsWebsite
                      ? "Your website content will be fetched and analyzed automatically when you run your first analysis."
                      : "Nothing is read automatically from social platforms - GrowthForge analyzes the description you provide. No scraping, no private-account access. If your customers mainly reach you through phone calls, walk-ins, or WhatsApp chats, describe that in your business details so the workspace reflects how you actually sell."}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 mb-4">
                  <div className="text-sm font-semibold text-white/70 mb-2">What GrowthForge will analyze</div>
                  <p className="text-sm text-white/50">{analysisLabel}.</p>
                </div>

                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5 mb-4">
                  <div className="text-sm font-semibold text-amber-300/80 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Still missing (optional)
                  </div>
                  {missing.length > 0 ? (
                    <ul className="text-sm text-white/50 list-disc list-inside space-y-1">
                      {missing.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  ) : (
                    <p className="text-sm text-white/50">Nothing important - you're good to go.</p>
                  )}
                  <p className="text-xs text-white/30 mt-3">
                    Manual information you provide is treated as <b>supplied by you</b>, not independently verified.
                  </p>
                </div>

                {error && <ErrorBox msg={error} />}
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={goBack} className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-white/70 hover:bg-white/8 transition-all flex items-center justify-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-[2] py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <SparklesIcon />} Launch My Workspace
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 5 - Creating ───────────────────────────────────────── */}
            {step === 5 && (
              <motion.div key="s5" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#00E676]/10 border border-[#00E676]/30 mb-6">
                  <Loader2 className="w-8 h-8 text-[#00E676] animate-spin" />
                </div>
                <h1 className="text-3xl font-bold mb-3">Creating your workspace...</h1>
                <p className="text-white/50">{region === "nigeria" ? "Setting up your GrowthForge workspace for the Nigerian market. This will only take a moment." : "Setting up your AI marketing OS. This will only take a moment."}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function SparklesIcon() {
  return <span className="text-base leading-none">✦</span>;
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{msg}</div>
  );
}

function Field({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm"
      />
    </div>
  );
}

function NavRow({ onBack, onNext, nextLabel }: { onBack: (() => void) | undefined; onNext: () => void; nextLabel: string }) {
  return (
    <div className="flex gap-3 mt-6">
      {onBack && (
        <button type="button" onClick={onBack} className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-white/70 hover:bg-white/8 transition-all flex items-center justify-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}
      <button type="button" onClick={onNext} className="flex-[2] py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all flex items-center justify-center gap-2">
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
