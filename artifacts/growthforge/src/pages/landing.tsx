import { useRef, useState } from "react";
import { Link } from "wouter";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  Brain, Video, Target, BarChart2, Zap, ArrowRight, Check,
  Users2, FileText, Share2, Mail, Bot, Star, Bell, X, Clock,
  Play, TrendingUp, Layers, Shield, Cpu, ChevronDown, ChevronUp,
  MessageSquare, Rocket, Globe, Building2, LineChart, Sparkles,
} from "lucide-react";

/* ─── Data ─────────────────────────────────────────────────── */

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how" },
  { label: "Forge AI", href: "#forge" },
  { label: "Pricing", href: "#pricing" },
  { label: "About", href: "/about" },
];

const BUILDS_FROM_URL = [
  {
    icon: Brain,
    title: "Business Intelligence",
    desc: "Understand your company, customers, positioning, strengths, weaknesses, and growth opportunities.",
    features: ["Business Analysis", "Customer Personas", "Market Research", "Audience Segmentation"],
    color: "#00E676",
  },
  {
    icon: Users2,
    title: "Competitor Intelligence",
    desc: "Discover competitors, identify market gaps, and uncover winning strategies.",
    features: ["Competitor Research", "Messaging Analysis", "Positioning Insights", "Opportunity Discovery"],
    color: "#00D4FF",
  },
  {
    icon: FileText,
    title: "Marketing Content",
    desc: "Generate content that helps attract and convert customers.",
    features: ["Blog Articles", "Social Media Posts", "Email Campaigns", "Ad Copy"],
    color: "#14F195",
  },
  {
    icon: Video,
    title: "Video Blueprints",
    desc: "Create ready-to-produce marketing videos without any editing experience.",
    features: ["Video Concepts", "Hooks", "Storyboards", "Voiceover Scripts"],
    color: "#00E676",
  },
  {
    icon: LineChart,
    title: "Growth Strategy",
    desc: "Receive actionable, AI-generated recommendations to scale your business.",
    features: ["SEO Strategy", "Growth Recommendations", "Conversion Opportunities", "Lead Generation Plans"],
    color: "#00D4FF",
  },
  {
    icon: Bot,
    title: "Forge AI Agent",
    desc: "Your always-on AI marketing assistant ready to execute on demand.",
    features: ["Campaign Ideas", "Content Creation", "Competitor Analysis", "Marketing Guidance"],
    color: "#14F195",
  },
];

const WORKFLOW_PIPELINE = [
  { icon: Globe, label: "Website URL" },
  { icon: Brain, label: "Business Analysis" },
  { icon: Users2, label: "Competitor Intelligence" },
  { icon: Target, label: "Marketing Strategy" },
  { icon: FileText, label: "Content Creation" },
  { icon: Video, label: "Video Blueprint" },
  { icon: TrendingUp, label: "Growth Recommendations" },
];

const BENEFIT_CARDS = [
  { icon: Brain, title: "Business Intelligence", desc: "AI scans your website, extracts your ICP, positioning, and growth opportunities in seconds." },
  { icon: Users2, title: "Competitor Intelligence", desc: "Discover competitors, map gaps, and see exactly how to win your market." },
  { icon: Sparkles, title: "AI Content Creation", desc: "Generate unlimited content, campaigns, videos, and ads — all tailored to your brand." },
  { icon: Cpu, title: "AI Marketing Automation", desc: "Autonomous campaigns that optimize 24/7 without manual intervention." },
];

const HOW_STEPS = [
  { num: "01", icon: Globe, title: "Paste Your Website URL", desc: "Enter your website and business details. No setup, no integrations required." },
  { num: "02", icon: Brain, title: "AI Analyzes Your Business", desc: "GrowthForge identifies your products, audience, positioning, and opportunities." },
  { num: "03", icon: Users2, title: "Competitor Discovery", desc: "Automatically identify your top competitors and uncover market gaps." },
  { num: "04", icon: Sparkles, title: "Generate Marketing Assets", desc: "Create content, campaigns, emails, ads, strategies, and video blueprints instantly." },
  { num: "05", icon: Rocket, title: "Scale Smarter", desc: "Use AI recommendations to continuously improve your marketing performance." },
];

const WHO_CARDS = [
  { icon: Rocket, title: "Startups", desc: "Launch faster with AI-powered marketing from day one. Skip the agency, own the strategy." },
  { icon: Building2, title: "Agencies", desc: "Deliver 10× more value to clients. Scale your output without scaling your headcount." },
  { icon: Globe, title: "Small Businesses", desc: "Operate like a full marketing team on a fraction of the budget." },
  { icon: TrendingUp, title: "Growth Teams", desc: "Scale campaigns, test faster, and make data-driven decisions with less effort." },
];

const FORGE_PROMPTS = [
  "Analyze my competitors and find market gaps",
  "Create a 30-day content calendar for LinkedIn",
  "Generate a lead generation strategy for Q3",
  "Build a TikTok campaign for product launch",
  "Write a full product launch email sequence",
];

const BI_CAPABILITIES = [
  "Business Model Analysis",
  "Customer Personas & ICP",
  "Audience Research",
  "Positioning Analysis",
  "Growth Opportunity Mapping",
  "Competitor Benchmarking",
];

const COMPETITOR_FEATURES = [
  "Automated Competitor Discovery",
  "Messaging & Positioning Analysis",
  "Strengths & Weaknesses Reports",
  "Market Gap Identification",
  "Competitive Positioning Gaps",
  "Win/Loss Intelligence",
];

const VIDEO_FEATURES = [
  "Video Concepts & Hooks",
  "Full Storyboards",
  "Voiceover Scripts",
  "Scene-by-Scene Breakdowns",
  "Platform-Specific CTAs",
  "TikTok / Reel Formats",
];

const TRUST_POINTS = [
  { icon: Brain, title: "AI-Powered Insights", desc: "Every recommendation is backed by real business intelligence, not generic templates." },
  { icon: Clock, title: "Save Dozens of Hours", desc: "What takes a marketing team weeks, GrowthForge delivers in minutes." },
  { icon: TrendingUp, title: "Scale Faster", desc: "Go from idea to full marketing department in one session." },
  { icon: Target, title: "Reduce Agency Costs", desc: "Replace $10K+/month agency retainers with one AI platform." },
  { icon: Layers, title: "All-In-One Platform", desc: "Strategy, content, video, social, email, ads — connected and unified." },
  { icon: Shield, title: "Built for Business", desc: "Designed for founders, marketers, and agencies who need real results." },
];

const FEATURES = [
  { icon: Brain, title: "Business Intelligence", desc: "AI scans your website and extracts your business model, ICP, pain points, opportunities, and competitive landscape in seconds." },
  { icon: Users2, title: "Competitor Intelligence", desc: "Discover and analyze your top competitors. Identify market gaps, messaging weaknesses, and your exact winning positioning." },
  { icon: FileText, title: "Content Engine", desc: "Generate blog posts, whitepapers, case studies, and SEO content tailored to your brand voice and ICP." },
  { icon: Video, title: "Video Studio", desc: "Create professional marketing videos — promos, product demos, TikTok shorts — with scripts and storyboards." },
  { icon: Share2, title: "Social Media Hub", desc: "30 days of platform-optimized social posts across LinkedIn, Instagram, TikTok, and X." },
  { icon: Mail, title: "Email Campaigns", desc: "Welcome sequences, sales flows, nurture campaigns, and reactivation emails — personalized to your funnel." },
  { icon: Target, title: "Campaign Manager", desc: "AI-managed ad campaigns across Google, Meta, and LinkedIn. Autonomous optimization 24/7." },
  { icon: Bot, title: "Forge AI Agent", desc: "Chat with your AI marketing agent. Say 'Generate a TikTok campaign' and watch it happen." },
  { icon: BarChart2, title: "Analytics & Reports", desc: "Real-time performance dashboards with AI-generated insights and recommendations." },
];

const TESTIMONIALS = [
  { name: "Sarah K.", role: "Founder, B2B SaaS", quote: "I canceled my $9,500/month marketing agency in week 1. GrowthForge does everything they did — and ships 10× faster.", stars: 5 },
  { name: "Marcus R.", role: "Agency Owner", quote: "I now serve 4× more clients without hiring anyone. The competitor intelligence alone changed how I position every client.", stars: 5 },
  { name: "Priya M.", role: "VP Marketing", quote: "We went from 2 blog posts a month to 30. Our organic traffic strategy is now completely AI-driven. Unprecedented.", stars: 5 },
];

const PRICING = [
  { name: "Starter", price: 99, desc: "For solo founders & small teams", features: ["1 project", "Content Engine", "Competitor analysis", "Email campaigns", "10 videos/month", "Analytics dashboard"], highlight: false },
  { name: "Growth", price: 299, desc: "For growing teams ready to scale", features: ["5 projects", "Everything in Starter", "30 videos/month", "Forge AI Agent", "Autonomous campaigns", "Priority support"], highlight: true },
  { name: "Agency", price: 799, desc: "For agencies & enterprise teams", features: ["Unlimited projects", "Everything in Growth", "Unlimited videos", "White-label reports", "Team collaboration", "Dedicated success manager"], highlight: false },
];

const FAQ = [
  { q: "What is GrowthForge?", a: "GrowthForge is an AI Growth Operating System. You paste your website URL and it builds your entire marketing department — strategy, content, competitor intelligence, videos, email campaigns, ads, and an AI agent — all in minutes." },
  { q: "How does GrowthForge work?", a: "Paste your URL. Our AI analyzes your business, discovers competitors, identifies market gaps, then generates a complete marketing strategy and all supporting assets tailored to your brand." },
  { q: "Do I need marketing experience?", a: "No. GrowthForge is designed for founders and operators who want results without needing to know marketing strategy. The platform guides you at every step." },
  { q: "Can I analyze competitors?", a: "Yes. GrowthForge automatically discovers your top competitors, analyzes their messaging, identifies their weaknesses, and shows you exactly how to position against them." },
  { q: "Can I generate content?", a: "Yes. GrowthForge generates blog posts, social media content, email campaigns, ad copy, and more — all tailored to your brand voice and audience." },
  { q: "Can I generate videos?", a: "GrowthForge generates complete video blueprints including concepts, hooks, storyboards, voiceover scripts, scene breakdowns, and CTAs — ready for production." },
  { q: "What happens during the free trial?", a: "You get full access to all features for 14 days — no credit card required. Run analyses, generate content, discover competitors, and build your marketing strategy." },
  { q: "Can I upgrade later?", a: "Yes. You can upgrade to a paid plan at any time. Paid plans are launching soon — join the early access waitlist to get notified first with an exclusive discount." },
];

const FOOTER_LINKS = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how" },
    { label: "Pricing", href: "#pricing" },
    { label: "Forge AI", href: "#forge" },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Refund Policy", href: "/refund-policy" },
  ],
};

/* ─── Helpers ───────────────────────────────────────────────── */

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 28 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] mb-4">
      <Zap className="w-3 h-3" />{children}
    </span>
  );
}

function EarlyAccessModal({ plan, onClose }: { plan: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.92, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }} transition={{ type: "spring", damping: 22, stiffness: 320 }}
        className="w-full max-w-md rounded-2xl border border-white/10 p-8 relative" style={{ background: "#080f1e" }}
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 transition-colors">
          <X className="w-4 h-4" />
        </button>
        {!submitted ? (
          <>
            <div className="w-12 h-12 rounded-xl bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mb-5"><Bell className="w-6 h-6 text-[#00E676]" /></div>
            <h2 className="text-2xl font-bold text-white mb-1">Join the {plan} waitlist</h2>
            <p className="text-white/50 text-sm mb-6">Paid plans are launching very soon. Be first in line and receive an exclusive early-access discount.</p>
            <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="flex flex-col gap-3">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E676]/50 text-sm" />
              <button type="submit" className="w-full py-3 rounded-xl bg-[#00E676] text-black font-bold text-sm hover:bg-[#14F195] transition-colors">Notify Me at Launch</button>
            </form>
            <p className="text-white/25 text-xs text-center mt-3">No spam. Unsubscribe anytime.</p>
          </>
        ) : (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 flex items-center justify-center mx-auto mb-4"><Check className="w-8 h-8 text-[#00E676]" /></div>
            <h3 className="text-xl font-bold text-white mb-2">You're on the list!</h3>
            <p className="text-white/50 text-sm mb-6">We'll email <strong className="text-white">{email}</strong> when {plan} launches with your exclusive discount.</p>
            <button onClick={onClose} className="px-6 py-2.5 rounded-full bg-white/8 text-white/70 text-sm hover:bg-white/15 transition-colors">Got it</button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ─── Dashboard Mockup ──────────────────────────────────────── */

function DashboardMockup({ active }: { active: string }) {
  const tabs = ["Analysis", "Competitors", "Strategy", "Videos", "Forge AI"];
  const panels: Record<string, React.ReactNode> = {
    Analysis: (
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-[#00E676]/20 flex items-center justify-center"><Brain className="w-4 h-4 text-[#00E676]" /></div>
          <div><div className="text-sm font-bold text-white">Business Intelligence Report</div><div className="text-xs text-white/40">acmecorp.com · analyzed 2 min ago</div></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[["Industry", "SaaS / B2B"], ["Stage", "Growth"], ["ICP", "SMB Founders"]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-white/5 border border-white/8 p-3">
              <div className="text-[10px] text-white/40 mb-1">{k}</div>
              <div className="text-xs font-bold text-white">{v}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-white/5 border border-white/8 p-4">
          <div className="text-xs font-semibold text-white/60 mb-2">Key Opportunities</div>
          {["Underserved mid-market segment", "Competitors lack AI-native features", "Strong organic SEO potential"].map((o) => (
            <div key={o} className="flex items-center gap-2 text-xs text-white/70 py-1.5 border-b border-white/5 last:border-0">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00E676]" />{o}
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-[#00E676]/8 border border-[#00E676]/20 p-3">
          <div className="text-xs font-semibold text-[#00E676] mb-1">AI Recommendation</div>
          <div className="text-xs text-white/60">Focus on content marketing targeting "AI marketing tools" — 4.2K monthly searches, low competition.</div>
        </div>
      </div>
    ),
    Competitors: (
      <div className="p-5 flex flex-col gap-3">
        <div className="text-sm font-bold text-white mb-1">Competitor Intelligence</div>
        {[
          { name: "HubSpot", score: 72, gap: "AI-native workflows", color: "#ff6b6b" },
          { name: "Jasper AI", score: 65, gap: "Full marketing OS", color: "#ffa94d" },
          { name: "Copy.ai", score: 60, gap: "Video & campaign mgmt", color: "#74c0fc" },
        ].map(({ name, score, gap, color }) => (
          <div key={name} className="rounded-xl bg-white/5 border border-white/8 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm text-white">{name}</div>
              <div className="text-xs px-2 py-0.5 rounded-full" style={{ background: color + "20", color }}>Threat: {score}</div>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 mb-2">
              <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
            </div>
            <div className="text-xs text-white/40">Gap: <span className="text-[#00E676]">{gap}</span></div>
          </div>
        ))}
      </div>
    ),
    Strategy: (
      <div className="p-5 flex flex-col gap-3">
        <div className="text-sm font-bold text-white mb-1">Marketing Strategy</div>
        {[
          { phase: "Month 1", focus: "Content & SEO Foundation", tasks: ["12 blog posts", "Keyword research", "On-page SEO"] },
          { phase: "Month 2", focus: "Social & Community", tasks: ["LinkedIn presence", "TikTok launch", "Email list growth"] },
          { phase: "Month 3", focus: "Paid Acquisition", tasks: ["Google Ads", "Meta retargeting", "LinkedIn campaigns"] },
        ].map(({ phase, focus, tasks }) => (
          <div key={phase} className="rounded-xl bg-white/5 border border-white/8 p-4">
            <div className="flex justify-between items-center mb-2">
              <div className="text-xs font-bold text-[#00E676]">{phase}</div>
              <div className="text-xs text-white/50">{focus}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tasks.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-white/60">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    ),
    Videos: (
      <div className="p-5 flex flex-col gap-3">
        <div className="text-sm font-bold text-white mb-1">Video Blueprints</div>
        {[
          { type: "Product Demo", hook: "Stop paying $10K/month for marketing...", platform: "YouTube", strength: 92 },
          { type: "TikTok Short", hook: "I replaced my entire marketing team with AI", platform: "TikTok", strength: 88 },
          { type: "Testimonial", hook: "How we 10× our content output in 30 days", platform: "LinkedIn", strength: 84 },
        ].map(({ type, hook, platform, strength }) => (
          <div key={type} className="rounded-xl bg-white/5 border border-white/8 p-4">
            <div className="flex justify-between items-start mb-1.5">
              <div>
                <div className="text-xs font-bold text-white">{type}</div>
                <div className="text-[10px] text-white/40">{platform}</div>
              </div>
              <div className="text-[10px] text-[#00E676] font-bold">{strength}% hook strength</div>
            </div>
            <div className="text-xs text-white/60 italic">"{hook}"</div>
          </div>
        ))}
      </div>
    ),
    "Forge AI": (
      <div className="p-5 flex flex-col gap-3 h-full">
        <div className="text-sm font-bold text-white mb-1">Forge AI Agent</div>
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex justify-end"><div className="bg-[#00E676]/15 border border-[#00E676]/20 rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs text-white max-w-[80%]">Analyze my competitors and find market gaps</div></div>
          <div className="flex justify-start"><div className="bg-white/5 border border-white/8 rounded-2xl rounded-tl-sm px-4 py-2.5 text-xs text-white/80 max-w-[85%]">Analyzing 5 competitors… Found 3 major market gaps. Your biggest opportunity: none of your competitors offer AI-native campaign automation. I recommend positioning GrowthForge as the first autonomous marketing OS. Want me to build a campaign around this angle?</div></div>
          <div className="flex justify-end"><div className="bg-[#00E676]/15 border border-[#00E676]/20 rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs text-white max-w-[80%]">Yes, create a TikTok campaign for this</div></div>
          <div className="flex justify-start items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-[#00E676]/20 flex items-center justify-center shrink-0"><Zap className="w-2.5 h-2.5 text-[#00E676]" /></div>
            <div className="text-xs text-white/40 italic">Forge is generating your TikTok campaign…</div>
          </div>
        </div>
      </div>
    ),
  };
  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "#060d1a" }}>
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8" style={{ background: "#040B14" }}>
        <div className="w-3 h-3 rounded-full bg-red-500/70" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
        <div className="w-3 h-3 rounded-full bg-green-500/70" />
        <div className="ml-3 flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-[#00E676]/20 flex items-center justify-center"><Zap className="w-2.5 h-2.5 text-[#00E676]" /></div>
          <span className="text-xs text-white/40 font-mono">GrowthForge Dashboard</span>
        </div>
      </div>
      <div className="flex border-b border-white/8 overflow-x-auto">
        {tabs.map((t) => (
          <div key={t} className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${t === active ? "text-[#00E676] border-b-2 border-[#00E676]" : "text-white/30"}`}>{t}</div>
        ))}
      </div>
      <div className="min-h-[280px]">{panels[active]}</div>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────── */

export default function LandingPage() {
  const [earlyAccessPlan, setEarlyAccessPlan] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("Analysis");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const W = "w-[93vw] max-w-[1380px] mx-auto";

  return (
    <div className="min-h-screen text-foreground overflow-x-hidden" style={{ background: "#040B14" }}>

      {/* ── Nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/8" style={{ background: "rgba(4,11,20,0.85)", backdropFilter: "blur(16px)" }}>
        <div className={`${W} h-16 flex items-center justify-between`}>
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#00E676]/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-[#00E676]" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">GrowthForge</span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm text-white/50">
            {NAV_LINKS.map(({ label, href }) =>
              href.startsWith("#")
                ? <a key={label} href={href} className="hover:text-white transition-colors">{label}</a>
                : <Link key={label} href={href} className="hover:text-white transition-colors">{label}</Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/sign-in" className="text-sm text-white/50 hover:text-white transition-colors hidden md:block">Sign In</Link>
            <Link href="/sign-up" className="text-sm font-bold px-4 py-2 rounded-lg text-black transition-all hover:scale-[1.02]" style={{ background: "#00E676" }}>
              Start Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-36 pb-28 px-4 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-[700px] w-[1100px] rounded-full blur-[140px]" style={{ background: "radial-gradient(ellipse, rgba(0,230,118,0.08) 0%, transparent 70%)" }} />
        </div>
        <div className={`${W} text-center relative`}>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <SectionLabel>AI Growth Operating System</SectionLabel>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.1 }}
            className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-[1.0] mb-6 text-white">
            Paste Your URL.<br />
            <span style={{ color: "#00E676" }}>Get Your Marketing</span><br />
            Department.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.2 }}
            className="text-xl md:text-2xl text-white/50 max-w-3xl mx-auto mb-10 leading-relaxed">
            GrowthForge is the AI Growth Operating System that analyzes your business, discovers competitors, creates marketing assets, generates video campaigns, and helps businesses scale faster.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <Link href="/sign-up" className="w-full sm:w-auto flex items-center justify-center gap-2 font-bold text-base px-8 py-4 rounded-xl transition-all shadow-lg hover:scale-[1.02] text-black"
              style={{ background: "#00E676", boxShadow: "0 0 40px rgba(0,230,118,0.25)" }}>
              Start Free Trial <ArrowRight className="h-5 w-5" />
            </Link>
            <a href="#showcase" className="w-full sm:w-auto flex items-center justify-center gap-2 text-white/70 font-semibold text-base px-8 py-4 rounded-xl border border-white/10 hover:border-white/25 hover:text-white transition-all"
              style={{ background: "rgba(255,255,255,0.04)" }}>
              <Play className="h-4 w-4" /> Watch Demo
            </a>
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
            className="text-sm text-white/30 flex items-center justify-center gap-4">
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#00E676]" /> No credit card required</span>
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#00E676]" /> 14-day free trial</span>
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#00E676]" /> Cancel anytime</span>
          </motion.p>

          {/* Benefit cards (replacing fake stats) */}
          <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.6 }}
            className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-4">
            {BENEFIT_CARDS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border border-white/8 p-5 text-left hover:border-[#00E676]/30 transition-colors" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="w-9 h-9 rounded-xl bg-[#00E676]/10 flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-[#00E676]" />
                </div>
                <div className="text-sm font-bold text-white mb-1">{title}</div>
                <div className="text-xs text-white/40 leading-relaxed">{desc}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Product Showcase ── */}
      <section id="showcase" className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-12">
            <SectionLabel>See It In Action</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">See GrowthForge In Action</h2>
            <p className="text-white/50 text-lg max-w-2xl mx-auto">Real dashboard. Real output. Built for real business growth.</p>
          </FadeIn>
          <FadeIn>
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {["Analysis", "Competitors", "Strategy", "Videos", "Forge AI"].map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === tab ? "text-black" : "text-white/50 border border-white/10 hover:border-white/25"}`}
                  style={activeTab === tab ? { background: "#00E676" } : { background: "rgba(255,255,255,0.04)" }}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="relative">
              <div className="absolute -inset-6 rounded-3xl blur-2xl pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(0,230,118,0.06) 0%, transparent 70%)" }} />
              <DashboardMockup active={activeTab} />
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how" className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>Process</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">How GrowthForge Works</h2>
            <p className="text-white/50 text-lg">From URL to full marketing department in under 10 minutes.</p>
          </FadeIn>
          <div className="grid md:grid-cols-5 gap-4">
            {HOW_STEPS.map(({ num, icon: Icon, title, desc }, i) => (
              <FadeIn key={num} delay={i * 0.09}>
                <div className="relative p-6 rounded-2xl border border-white/8 hover:border-[#00E676]/30 transition-all group h-full" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="text-4xl font-black font-mono mb-4" style={{ color: "rgba(0,230,118,0.2)" }}>{num}</div>
                  <div className="w-9 h-9 rounded-xl bg-[#00E676]/10 flex items-center justify-center mb-3 group-hover:bg-[#00E676]/20 transition-colors">
                    <Icon className="w-4 h-4 text-[#00E676]" />
                  </div>
                  <h3 className="font-bold text-white mb-2 text-sm">{title}</h3>
                  <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Visual Workflow ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>The Pipeline</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">From One URL to a Full Marketing Engine</h2>
            <p className="text-white/50 text-lg max-w-xl mx-auto">Every output is generated automatically — in minutes, not months.</p>
          </FadeIn>
          <FadeIn>
            {/* Desktop: horizontal flow */}
            <div className="hidden md:flex items-center justify-center gap-0 overflow-x-auto pb-4">
              {WORKFLOW_PIPELINE.map(({ icon: Icon, label }, i) => (
                <div key={label} className="flex items-center">
                  <div className="flex flex-col items-center gap-3 min-w-[110px]">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all`}
                      style={{
                        background: i === 0 ? "rgba(0,230,118,0.15)" : "rgba(255,255,255,0.04)",
                        border: i === 0 ? "1px solid rgba(0,230,118,0.4)" : "1px solid rgba(255,255,255,0.1)",
                        boxShadow: i === 0 ? "0 0 24px rgba(0,230,118,0.15)" : "none",
                      }}>
                      <Icon className="w-5 h-5" style={{ color: i === 0 ? "#00E676" : i === WORKFLOW_PIPELINE.length - 1 ? "#14F195" : "rgba(255,255,255,0.5)" }} />
                    </div>
                    <span className="text-xs text-center font-medium leading-tight" style={{ color: i === 0 ? "#00E676" : i === WORKFLOW_PIPELINE.length - 1 ? "#14F195" : "rgba(255,255,255,0.5)" }}>
                      {label}
                    </span>
                  </div>
                  {i < WORKFLOW_PIPELINE.length - 1 && (
                    <div className="flex items-center -mt-6 mx-1">
                      <div className="w-6 h-px" style={{ background: "linear-gradient(90deg, rgba(0,230,118,0.3), rgba(0,212,255,0.3))" }} />
                      <ArrowRight className="w-3.5 h-3.5 -ml-1" style={{ color: "rgba(0,230,118,0.4)" }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Mobile: vertical flow */}
            <div className="md:hidden flex flex-col items-center gap-0 max-w-xs mx-auto">
              {WORKFLOW_PIPELINE.map(({ icon: Icon, label }, i) => (
                <div key={label} className="flex flex-col items-center">
                  <div className="flex items-center gap-4 py-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: i === 0 ? "rgba(0,230,118,0.15)" : "rgba(255,255,255,0.04)",
                        border: i === 0 ? "1px solid rgba(0,230,118,0.4)" : "1px solid rgba(255,255,255,0.1)",
                      }}>
                      <Icon className="w-5 h-5" style={{ color: i === 0 ? "#00E676" : i === WORKFLOW_PIPELINE.length - 1 ? "#14F195" : "rgba(255,255,255,0.5)" }} />
                    </div>
                    <span className="text-sm font-medium" style={{ color: i === 0 ? "#00E676" : i === WORKFLOW_PIPELINE.length - 1 ? "#14F195" : "rgba(255,255,255,0.6)" }}>
                      {label}
                    </span>
                  </div>
                  {i < WORKFLOW_PIPELINE.length - 1 && (
                    <div className="w-px h-6" style={{ background: "linear-gradient(180deg, rgba(0,230,118,0.3), rgba(0,212,255,0.3))" }} />
                  )}
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Mid CTA ── */}
      <section className="py-16 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="rounded-2xl border border-[#00E676]/20 p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-6"
            style={{ background: "linear-gradient(135deg, rgba(0,230,118,0.06) 0%, rgba(0,212,255,0.04) 100%)" }}>
            <div>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-2">Ready to replace your marketing team?</h3>
              <p className="text-white/50">Start your free 14-day trial. No credit card, no commitment.</p>
            </div>
            <Link href="/sign-up" className="shrink-0 flex items-center gap-2 font-bold px-8 py-4 rounded-xl text-black hover:scale-[1.02] transition-all"
              style={{ background: "#00E676", boxShadow: "0 0 30px rgba(0,230,118,0.2)" }}>
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </Link>
          </FadeIn>
        </div>
      </section>

      {/* ── Builds From URL ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>What You Get</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">
              Everything GrowthForge Builds<br className="hidden md:block" /> From One URL
            </h2>
            <p className="text-white/50 text-lg max-w-2xl mx-auto">Turn a single website URL into a complete AI-powered marketing engine.</p>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
            {BUILDS_FROM_URL.map(({ icon: Icon, title, desc, features: feats, color }, i) => (
              <FadeIn key={title} delay={i * 0.07}>
                <div className="group p-6 rounded-2xl border border-white/8 hover:border-white/20 h-full transition-all relative overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(12px)" }}>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl"
                    style={{ background: `radial-gradient(ellipse at top left, ${color}08 0%, transparent 60%)` }} />
                  <div className="relative">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-colors"
                      style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
                      <Icon className="w-5 h-5" style={{ color }} />
                    </div>
                    <h3 className="font-bold text-white text-base mb-2">{title}</h3>
                    <p className="text-white/40 text-sm leading-relaxed mb-5">{desc}</p>
                    <div className="flex flex-col gap-2">
                      {feats.map((f) => (
                        <div key={f} className="flex items-center gap-2.5 text-xs text-white/50">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{f}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/sign-up" className="flex items-center gap-2 font-bold px-8 py-4 rounded-xl text-black transition-all hover:scale-[1.02]"
              style={{ background: "#00E676", boxShadow: "0 0 30px rgba(0,230,118,0.2)" }}>
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#features" className="flex items-center gap-2 font-semibold px-8 py-4 rounded-xl border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-all">
              See All Features
            </a>
          </FadeIn>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>Platform</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Everything a Marketing Team Does</h2>
            <p className="text-white/50 text-lg max-w-2xl mx-auto">One platform that replaces strategy consultants, content writers, video producers, ad managers, and data analysts.</p>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <FadeIn key={title} delay={i * 0.06}>
                <div className="p-6 rounded-2xl border border-white/8 hover:border-[#00E676]/30 transition-all group h-full" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="h-10 w-10 rounded-xl bg-[#00E676]/10 flex items-center justify-center mb-4 group-hover:bg-[#00E676]/20 transition-colors">
                    <Icon className="h-5 w-5 text-[#00E676]" />
                  </div>
                  <h3 className="font-bold mb-2 text-white">{title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Who It's For ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>Who It's For</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Built For Growth-Focused Businesses</h2>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHO_CARDS.map(({ icon: Icon, title, desc }, i) => (
              <FadeIn key={title} delay={i * 0.08}>
                <div className="p-7 rounded-2xl border border-white/8 hover:border-[#00E676]/30 transition-all text-center group h-full" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="w-12 h-12 rounded-2xl bg-[#00E676]/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-[#00E676]/20 transition-colors">
                    <Icon className="w-6 h-6 text-[#00E676]" />
                  </div>
                  <h3 className="font-bold text-white mb-2">{title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Forge AI ── */}
      <section id="forge" className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <FadeIn>
              <SectionLabel>Forge AI Agent</SectionLabel>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Meet Forge</h2>
              <p className="text-xl font-semibold text-[#00E676] mb-4">Your AI Growth Partner</p>
              <p className="text-white/50 text-lg leading-relaxed mb-8">
                Forge is your always-on AI marketing agent. Ask it anything, and it executes — from competitive analysis to full campaign builds in seconds.
              </p>
              <div className="flex flex-col gap-2">
                {FORGE_PROMPTS.map((prompt) => (
                  <div key={prompt} className="flex items-center gap-3 p-3 rounded-xl border border-white/8 hover:border-[#00E676]/30 transition-colors" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <MessageSquare className="w-4 h-4 text-[#00E676] shrink-0" />
                    <span className="text-sm text-white/60 italic">"{prompt}"</span>
                  </div>
                ))}
              </div>
            </FadeIn>
            <FadeIn delay={0.15}>
              <DashboardMockup active="Forge AI" />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Business Intelligence ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <FadeIn delay={0.1}>
              <DashboardMockup active="Analysis" />
            </FadeIn>
            <FadeIn>
              <SectionLabel>Intelligence</SectionLabel>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">AI-Powered Business Intelligence</h2>
              <p className="text-white/50 text-lg leading-relaxed mb-8">
                GrowthForge reads your entire website and extracts deep business intelligence — so every recommendation is specific to your business, not generic advice.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {BI_CAPABILITIES.map((cap) => (
                  <div key={cap} className="flex items-center gap-2.5 text-sm text-white/60">
                    <Check className="w-4 h-4 text-[#00E676] shrink-0" />{cap}
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Competitor Intelligence ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <FadeIn>
              <SectionLabel>Competitive Edge</SectionLabel>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Discover What Your Competitors Are Missing</h2>
              <p className="text-white/50 text-lg leading-relaxed mb-8">
                Automatically discover your top competitors, analyze their strategies, and identify the exact gaps you can win.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {COMPETITOR_FEATURES.map((f) => (
                  <div key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                    <Check className="w-4 h-4 text-[#00E676] shrink-0" />{f}
                  </div>
                ))}
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <DashboardMockup active="Competitors" />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Video Blueprint ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <FadeIn delay={0.1}>
              <DashboardMockup active="Videos" />
            </FadeIn>
            <FadeIn>
              <SectionLabel>Video Studio</SectionLabel>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Create Marketing Videos Faster</h2>
              <p className="text-white/50 text-lg leading-relaxed mb-4">
                GrowthForge generates complete video production blueprints. No video editing experience required.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {VIDEO_FEATURES.map((f) => (
                  <div key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                    <Check className="w-4 h-4 text-[#00E676] shrink-0" />{f}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[#00E676]/20 bg-[#00E676]/8 text-sm text-[#00E676]">
                <Check className="w-4 h-4 shrink-0" /> No video editing experience required
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>Social Proof</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">What Early Users Are Saying</h2>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map(({ name, role, quote, stars }, i) => (
              <FadeIn key={name} delay={i * 0.1}>
                <div className="p-7 rounded-2xl border border-white/8 flex flex-col gap-5 h-full" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="flex gap-1">
                    {Array.from({ length: stars }).map((_, j) => <Star key={j} className="h-4 w-4 text-yellow-400 fill-yellow-400" />)}
                  </div>
                  <p className="text-white/70 text-sm leading-relaxed flex-1">"{quote}"</p>
                  <div>
                    <div className="font-semibold text-white text-sm">{name}</div>
                    <div className="text-xs text-white/40">{role}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-16">
            <SectionLabel>Why GrowthForge</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Why Businesses Choose GrowthForge</h2>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {TRUST_POINTS.map(({ icon: Icon, title, desc }, i) => (
              <FadeIn key={title} delay={i * 0.07}>
                <div className="flex gap-4 p-6 rounded-2xl border border-white/8 h-full" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <div className="w-10 h-10 rounded-xl bg-[#00E676]/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-[#00E676]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white mb-1 text-sm">{title}</h3>
                    <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 px-4 border-t border-white/8">
        <div className={W}>
          <FadeIn className="text-center mb-10">
            <SectionLabel>Pricing</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Simple, Transparent Pricing</h2>
            <p className="text-white/50 text-lg">Replace a $120K/year marketing team for a fraction of the cost.</p>
          </FadeIn>
          <FadeIn className="flex justify-center mb-10">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/10">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-amber-400 text-sm font-semibold">Paid plans launching soon — start free today</span>
            </div>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {PRICING.map(({ name, price, desc, features: feats, highlight }, i) => (
              <FadeIn key={name} delay={i * 0.1}>
                <div className={`p-8 rounded-2xl border flex flex-col gap-6 h-full relative ${highlight ? "border-[#00E676]/40" : "border-white/8"}`}
                  style={{ background: highlight ? "linear-gradient(135deg, rgba(0,230,118,0.06) 0%, rgba(4,11,20,1) 60%)" : "rgba(255,255,255,0.02)" }}>
                  {highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold text-black" style={{ background: "#00E676" }}>Most Popular</div>}
                  <div>
                    <div className="text-xl font-bold text-white mb-0.5">{name}</div>
                    <div className="text-xs text-white/40 mb-3">{desc}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black text-white">${price}</span>
                      <span className="text-white/40">/month</span>
                    </div>
                  </div>
                  <ul className="flex flex-col gap-2.5 flex-1">
                    {feats.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                        <Check className={`h-4 w-4 shrink-0 ${highlight ? "text-[#00E676]" : "text-white/30"}`} />{f}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-2">
                    <button onClick={() => setEarlyAccessPlan(name)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all"
                      style={highlight ? { background: "#00E676", color: "#040B14" } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      <Bell className="w-3.5 h-3.5" /> Join Early Access
                    </button>
                    <p className="text-center text-[10px] text-white/25">Billing coming soon · No charge now</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn className="text-center mt-8">
            <p className="text-white/30 text-sm">
              Want to use GrowthForge now?{" "}
              <Link href="/sign-up" className="hover:underline font-semibold" style={{ color: "#00E676" }}>Start your free 14-day trial</Link>
              {" "}— no credit card required.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-24 px-4 border-t border-white/8">
        <div className="w-[93vw] max-w-[760px] mx-auto">
          <FadeIn className="text-center mb-12">
            <SectionLabel>FAQ</SectionLabel>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Frequently Asked Questions</h2>
          </FadeIn>
          <div className="flex flex-col gap-3">
            {FAQ.map(({ q, a }, i) => (
              <FadeIn key={q} delay={i * 0.04}>
                <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <button className="w-full flex items-center justify-between p-6 text-left" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    <span className="font-semibold text-white text-sm pr-4">{q}</span>
                    {openFaq === i ? <ChevronUp className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/40 shrink-0" />}
                  </button>
                  <AnimatePresence>
                    {openFaq === i && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }} className="overflow-hidden">
                        <div className="px-6 pb-5 text-sm text-white/50 leading-relaxed border-t border-white/5 pt-4">{a}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-28 px-4 border-t border-white/8">
        <div className={`${W} text-center relative`}>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-[400px] w-[800px] rounded-full blur-[120px]" style={{ background: "radial-gradient(ellipse, rgba(0,230,118,0.1) 0%, transparent 70%)" }} />
          </div>
          <FadeIn className="relative">
            <SectionLabel>Get Started</SectionLabel>
            <h2 className="text-5xl md:text-6xl font-black tracking-tighter text-white mb-4">Your Marketing Department<br />Starts Now.</h2>
            <p className="text-white/50 text-xl mb-10 max-w-2xl mx-auto">No agency fees. No hiring. No waiting months for results. Just paste your URL.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up" className="flex items-center gap-2 font-bold text-lg px-10 py-5 rounded-xl text-black transition-all hover:scale-[1.02]"
                style={{ background: "#00E676", boxShadow: "0 0 50px rgba(0,230,118,0.3)" }}>
                Start Free Trial <ArrowRight className="h-5 w-5" />
              </Link>
              <Link href="/contact" className="flex items-center gap-2 font-semibold text-base px-8 py-5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 transition-all">
                Book a Demo
              </Link>
            </div>
            <p className="mt-5 text-sm text-white/25">Free 14-day trial · No credit card required · Cancel anytime</p>
          </FadeIn>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/8 py-16 px-4" style={{ background: "rgba(0,0,0,0.3)" }}>
        <div className={W}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2">
              <Link href="/" className="flex items-center gap-2.5 mb-4">
                <div className="h-8 w-8 rounded-lg bg-[#00E676]/20 flex items-center justify-center"><Zap className="h-4 w-4 text-[#00E676]" /></div>
                <span className="font-bold text-white">GrowthForge</span>
              </Link>
              <p className="text-white/40 text-sm leading-relaxed max-w-xs">The AI Growth Operating System for ambitious businesses. Paste your URL. Get your marketing department.</p>
              <div className="mt-4 text-xs text-white/25">By Strapli Technologies Inc.</div>
            </div>
            {Object.entries(FOOTER_LINKS).map(([section, links]) => (
              <div key={section}>
                <div className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">{section}</div>
                <div className="flex flex-col gap-2.5">
                  {links.map(({ label, href }) =>
                    href.startsWith("#")
                      ? <a key={label} href={href} className="text-sm text-white/50 hover:text-white transition-colors">{label}</a>
                      : <Link key={label} href={href} className="text-sm text-white/50 hover:text-white transition-colors">{label}</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-white/8 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/25">
            <span>© {new Date().getFullYear()} Strapli Technologies Inc. All rights reserved.</span>
            <div className="flex items-center gap-4">
              <a href="https://usegrowthforge.com" className="hover:text-white/50 transition-colors">UseGrowthForge.com</a>
              <a href="https://linkedin.com" target="_blank" rel="noopener" className="hover:text-white/50 transition-colors">LinkedIn</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Early Access Modal */}
      <AnimatePresence>
        {earlyAccessPlan && <EarlyAccessModal plan={earlyAccessPlan} onClose={() => setEarlyAccessPlan(null)} />}
      </AnimatePresence>
    </div>
  );
}
