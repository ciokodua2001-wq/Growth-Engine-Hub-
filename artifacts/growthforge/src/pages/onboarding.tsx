import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Globe, Instagram, Facebook, Music2, Loader2, PenLine, Target, Users } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { getClientRegion } from "@/lib/region";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentUser } from "@/hooks/use-current-user";

const INDUSTRIES = [
  "Retail and general trading",
  "Fashion and clothing",
  "Beauty and personal care",
  "Food and restaurants",
  "Hospitality",
  "Real estate",
  "Professional services",
  "Education and training",
  "Digital services",
  "Marketing agencies",
  "Other businesses",
];

const GOALS = [
  "Get more customers",
  "Increase online sales",
  "Grow Instagram or Facebook presence",
  "Promote a new product or service",
  "Get more walk-in or phone enquiries",
  "Build a clearer marketing plan",
];

const SOURCES = [
  { id: "website", label: "Website", hint: "Best if you already have a business website.", icon: Globe, placeholder: "https://yourbusiness.com.ng" },
  { id: "instagram", label: "Instagram", hint: "Add your page if customers find you there.", icon: Instagram, placeholder: "https://instagram.com/yourbusiness" },
  { id: "facebook", label: "Facebook", hint: "Add your Facebook page if you use it for marketing.", icon: Facebook, placeholder: "https://facebook.com/yourbusiness" },
  { id: "tiktok", label: "TikTok", hint: "Add your TikTok if you actively market there.", icon: Music2, placeholder: "https://tiktok.com/@yourbusiness" },
  { id: "manual", label: "No website yet", hint: "You can still continue without a website or supported public page.", icon: PenLine, placeholder: "" },
] as const;

type SourceType = (typeof SOURCES)[number]["id"];

interface OnboardingState {
  user: {
    onboardingComplete?: boolean;
    trialEndsAt?: string | null;
    subscriptionStatus?: string | null;
    plan?: string | null;
  } | null;
  project: {
    id: number;
    name: string;
    websiteUrl?: string | null;
    industry?: string | null;
    description?: string | null;
    sourceType?: string | null;
    sourceUrl?: string | null;
  } | null;
  sources: Array<{ sourceType: string; sourceUrl?: string | null; declaredContent?: string | null }>;
}

export default function OnboardingPage() {
  const region = getClientRegion();
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useAuth();
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();

  const [loadingState, setLoadingState] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");

  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [customIndustry, setCustomIndustry] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [targetCustomers, setTargetCustomers] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState(GOALS[0]);
  const [location, setBusinessLocation] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("manual");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [declaredDescription, setDeclaredDescription] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded && !user) setLocation("/sign-in");
  }, [isLoaded, user, setLocation]);

  useEffect(() => {
    if (!isLoaded || !user || !currentUser) return;
    if (currentUser.onboardingComplete) {
      setLocation("/dashboard");
    }
  }, [isLoaded, user, currentUser, setLocation]);

  useEffect(() => {
    if (!isLoaded || !user) return;

    let cancelled = false;
    async function loadExisting() {
      try {
        const res = await fetch("/api/onboarding", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as OnboardingState;

        if (data.project) {
          setProjectId(data.project.id);
          setBusinessName(data.project.name ?? "");
          setWebsiteUrl(data.project.websiteUrl ?? "");
          setSourceType((data.project.sourceType as SourceType | null) ?? "manual");
          setSourceUrl(data.project.sourceUrl ?? "");
          setIndustry(data.project.industry ?? INDUSTRIES[0]);

          const description = data.project.description ?? "";
          const about = description.match(/About: (.*?)( \| |$)/)?.[1] ?? "";
          const customers = description.match(/Customers: (.*?)( \| |$)/)?.[1] ?? "";
          const goal = description.match(/Goal: (.*?)( \| |$)/)?.[1] ?? "";
          const loc = description.match(/Location: (.*?)( \| |$)/)?.[1] ?? "";
          setBusinessDescription(about);
          setTargetCustomers(customers);
          setPrimaryGoal(goal || GOALS[0]);
          setBusinessLocation(loc);
        }

        const primarySource = data.sources?.[0];
        if (primarySource?.declaredContent) setDeclaredDescription(primarySource.declaredContent);
        if (data.user?.trialEndsAt) setTrialEndsAt(data.user.trialEndsAt);
      } finally {
        if (!cancelled) setLoadingState(false);
      }
    }

    loadExisting();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, user]);

  const actualIndustry = useMemo(() => (industry === "Other businesses" ? customIndustry.trim() || industry : industry), [industry, customIndustry]);
  const isWebsite = sourceType === "website";
  const remainingDays = useMemo(() => {
    if (!trialEndsAt) return 7;
    const diff = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [trialEndsAt]);

  function canContinueFromBusiness() {
    return businessName.trim().length > 1 && businessDescription.trim().length > 4;
  }

  function canContinueFromCustomers() {
    return targetCustomers.trim().length > 2;
  }

  function canContinueFromPresence() {
    if (isWebsite) return websiteUrl.trim().length > 0;
    if (sourceType === "manual") return true;
    return sourceUrl.trim().length > 0 || declaredDescription.trim().length > 0;
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const trialRes = await fetch("/api/auth/start-trial", {
        method: "POST",
        credentials: "include",
      });
      if (trialRes.ok) {
        const trialData = await trialRes.json();
        setTrialEndsAt(trialData.trialEndsAt ?? null);
      }

      const payload = {
        businessName: businessName.trim(),
        industry: actualIndustry,
        businessDescription: businessDescription.trim(),
        targetCustomers: targetCustomers.trim(),
        primaryGoal,
        location: location.trim() || null,
        sourceType,
        websiteUrl: isWebsite ? websiteUrl.trim() : null,
        sourceUrl: !isWebsite && sourceType !== "manual" ? sourceUrl.trim() || null : null,
        declaredDescription: declaredDescription.trim() || null,
        operatingModel: "business",
      };

      const res = await fetch("/api/onboarding", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "We could not finish your setup. Please try again.");
        return;
      }

      setProjectId(data.project?.id ?? null);
      setLocation(data.project?.id ? `/analysis-progress/${data.project.id}` : "/dashboard");
    } catch {
      setError("Network error while setting up your workspace. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if ((isLoaded && !user) || userLoading || loadingState) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#040B14" }}>
        <Loader2 className="h-6 w-6 animate-spin text-[#00E676]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#040B14] text-white">
      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-3">
            <Logo size={44} />
            <div>
              <h1 className="text-xl font-bold">GrowthForge Nigeria Setup</h1>
              <p className="text-sm text-white/60">Get your business ready in a few quick steps.</p>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-[#1e3a5f] bg-[#081526] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#00E676]">7-day free trial</p>
              <p className="text-sm text-white/70">
                {trialEndsAt
                  ? `You have ${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining. Paid activation pending after trial.`
                  : "Your 7-day free trial starts when you complete setup. Paid activation remains pending after trial."}
              </p>
            </div>
            <div className="text-xs text-white/50">No card required * No automatic charge</div>
          </div>
        </div>

        <div className="mb-8 flex items-center gap-2 text-xs text-white/50 overflow-x-auto">
          {["Business", "Customers & goal", "Online presence", "Review"].map((label, index) => {
            const current = index + 1;
            const active = step === current;
            const done = step > current;
            return (
              <div key={label} className="flex items-center gap-2 shrink-0">
                <div className={`h-7 w-7 rounded-full border flex items-center justify-center ${done ? "bg-[#00E676] text-black border-[#00E676]" : active ? "border-[#00E676] text-[#00E676]" : "border-white/15 text-white/50"}`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : current}
                </div>
                <span className={active ? "text-white" : ""}>{label}</span>
                {current < 4 && <ArrowRight className="h-3.5 w-3.5 opacity-40" />}
              </div>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="rounded-3xl border border-[#1e3a5f] bg-[#081526] p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-5">
                <Building2 className="h-6 w-6 text-[#00E676]" />
                <div>
                  <h2 className="text-2xl font-bold">Tell us about your business</h2>
                  <p className="text-sm text-white/60">Keep it simple. We only ask for what GrowthForge needs to help you market better.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Example: Ada Fashion House" />
                <div>
                  <label className="block text-sm font-medium mb-1.5">Business category</label>
                  <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white text-sm focus:outline-none focus:border-[#00E676]/50 transition-colors">
                    {INDUSTRIES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
              </div>
              {industry === "Other businesses" && (
                <div className="mt-4">
                  <Field label="Your industry" value={customIndustry} onChange={setCustomIndustry} placeholder="Example: Auto parts distribution" />
                </div>
              )}
              <div className="mt-4">
                <TextArea label="Short business description" value={businessDescription} onChange={setBusinessDescription} placeholder="Tell us what you sell or the service you provide." />
              </div>
              <div className="mt-6 flex justify-end">
                <PrimaryButton onClick={() => canContinueFromBusiness() ? setStep(2) : setError("Please enter your business name, category, and a short description.")}>Continue</PrimaryButton>
              </div>
              {error && <ErrorBox msg={error} />}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="rounded-3xl border border-[#1e3a5f] bg-[#081526] p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-5">
                <Users className="h-6 w-6 text-[#00E676]" />
                <div>
                  <h2 className="text-2xl font-bold">Who are you trying to reach?</h2>
                  <p className="text-sm text-white/60">This helps GrowthForge tailor your first strategy and content ideas.</p>
                </div>
              </div>
              <TextArea label="Target customers" value={targetCustomers} onChange={setTargetCustomers} placeholder="Example: Busy working women in Lagos looking for ready-to-wear outfits." />
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Primary marketing goal</label>
                  <select value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white text-sm focus:outline-none focus:border-[#00E676]/50 transition-colors">
                    {GOALS.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
                  </select>
                </div>
                <Field label="Business location (optional)" value={location} onChange={setBusinessLocation} placeholder="Example: Lekki, Lagos" />
              </div>
              <NavRow onBack={() => { setError(""); setStep(1); }} onNext={() => canContinueFromCustomers() ? setStep(3) : setError("Please tell us who your customers are before continuing.")} nextLabel="Continue" />
              {error && <ErrorBox msg={error} />}
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="rounded-3xl border border-[#1e3a5f] bg-[#081526] p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-5">
                <Globe className="h-6 w-6 text-[#00E676]" />
                <div>
                  <h2 className="text-2xl font-bold">Where do customers find you online?</h2>
                  <p className="text-sm text-white/60">Choose one main presence. WhatsApp is not listed because GrowthForge does not analyze or optimize it directly.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SOURCES.map((source) => {
                  const Icon = source.icon;
                  const selected = sourceType === source.id;
                  return (
                    <button key={source.id} type="button" onClick={() => setSourceType(source.id)} className={`rounded-2xl border p-4 text-left transition-colors ${selected ? "border-[#00E676] bg-[#00E676]/10" : "border-white/10 bg-[#0d1b2e] hover:border-white/20"}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <Icon className="h-5 w-5 text-[#00E676]" />
                        <span className="font-semibold">{source.label}</span>
                      </div>
                      <p className="text-sm text-white/60">{source.hint}</p>
                    </button>
                  );
                })}
              </div>
              {isWebsite && <div className="mt-4"><Field label="Website URL" value={websiteUrl} onChange={setWebsiteUrl} placeholder="https://yourbusiness.com.ng" /></div>}
              {!isWebsite && sourceType !== "manual" && <div className="mt-4"><Field label="Page or profile URL" value={sourceUrl} onChange={setSourceUrl} placeholder={SOURCES.find((s) => s.id === sourceType)?.placeholder ?? "https://"} /></div>}
              {sourceType !== "website" && (
                <div className="mt-4">
                  <TextArea label={sourceType === "manual" ? "How customers currently find you" : "Extra context (optional)"} value={declaredDescription} onChange={setDeclaredDescription} placeholder={sourceType === "manual" ? "Example: Most orders come through referrals, phone calls, and walk-ins from people around Surulere." : "Example: We post new arrivals and promo offers every week."} />
                </div>
              )}
              <NavRow onBack={() => { setError(""); setStep(2); }} onNext={() => canContinueFromPresence() ? setStep(4) : setError(isWebsite ? "Please enter your website URL." : "Add your main public page or briefly describe how customers find you.")} nextLabel="Review" />
              {error && <ErrorBox msg={error} />}
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="rounded-3xl border border-[#1e3a5f] bg-[#081526] p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-5">
                <Target className="h-6 w-6 text-[#00E676]" />
                <div>
                  <h2 className="text-2xl font-bold">Review and launch</h2>
                  <p className="text-sm text-white/60">We'll take you into your dashboard and first AI marketing workflow next.</p>
                </div>
              </div>
              <div className="space-y-4 text-sm">
                <SummaryRow label="Business" value={businessName} />
                <SummaryRow label="Category" value={actualIndustry} />
                <SummaryRow label="Customers" value={targetCustomers} />
                <SummaryRow label="Goal" value={primaryGoal} />
                <SummaryRow label="Location" value={location || "Not provided"} />
                <SummaryRow label="Main online presence" value={sourceType === "manual" ? "No website or supported public page yet" : sourceType} />
                <SummaryRow label="Link" value={isWebsite ? websiteUrl || "Not provided" : sourceUrl || "Not provided"} />
                <SummaryRow label="Trial" value={trialEndsAt ? `Ends ${new Date(trialEndsAt).toLocaleString()}` : "7 days, no automatic charge"} />
                {projectId && <SummaryRow label="Existing setup" value="Resuming your saved onboarding" />}
              </div>
              <div className="mt-6 rounded-xl border border-[#1e3a5f] bg-[#0d1b2e] px-4 py-3 text-sm text-white/70">
                {region === "nigeria" ? "Paid activation pending after trial. Paystack is not active yet, and you will not be charged automatically." : "Paid activation is pending after trial. No automatic charge is applied here."}
              </div>
              <div className="flex gap-3 mt-6">
                <SecondaryButton onClick={() => { setError(""); setStep(3); }}><ArrowLeft className="h-4 w-4" /> Back</SecondaryButton>
                <PrimaryButton onClick={submit} disabled={submitting}>{submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Setting up...</> : <>Launch my workspace <ArrowRight className="h-4 w-4" /></>}</PrimaryButton>
              </div>
              {error && <ErrorBox msg={error} />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm" />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} className="w-full px-4 py-3 rounded-xl bg-[#0d1b2e] border border-white/10 text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors text-sm resize-y" />
    </div>
  );
}

function NavRow({ onBack, onNext, nextLabel }: { onBack: () => void; onNext: () => void; nextLabel: string }) {
  return (
    <div className="flex gap-3 mt-6">
      <SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</SecondaryButton>
      <PrimaryButton onClick={onNext}>{nextLabel} <ArrowRight className="h-4 w-4" /></PrimaryButton>
    </div>
  );
}

function PrimaryButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-[#00E676] text-black hover:bg-[#14F195] transition-all flex items-center justify-center gap-2 disabled:opacity-60">{children}</button>;
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-white/70 hover:bg-white/8 transition-all flex items-center justify-center gap-2">{children}</button>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1b2e] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-white/45 mb-1">{label}</div>
      <div className="text-white/85">{value}</div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{msg}</div>;
}
