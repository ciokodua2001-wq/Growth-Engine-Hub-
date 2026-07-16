import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { useUser, UserButton, useClerk } from "@clerk/react";
import {
  Brain, Video, Target, BarChart2, Zap, ArrowRight, Check,
  Users2, FileText, Share2, Mail, Bot, Star, Bell, X, Clock,
  Play, TrendingUp, Layers, Shield, Cpu, ChevronDown, ChevronUp,
  MessageSquare, Rocket, Globe, Building2, LineChart, Sparkles,
  LayoutDashboard, Crown, Menu,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

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
    title: "Video Generation",
    desc: "Generate and render marketing videos ready to post — no editing experience required.",
    features: ["Video Concepts", "Hooks", "Storyboards", "Rendered Videos"],
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
  { icon: Video, label: "Video Generation" },
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
  { num: "04", icon: Sparkles, title: "Generate Marketing Assets", desc: "Create content, campaigns, emails, ads, strategies, and videos instantly." },
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
  {
    name: "Starter", price: 39, color: "#00E676", highlight: false,
    desc: "For solo founders and small businesses",
    stats: [{ value: "1", label: "Project" }, { value: "8 min", label: "Video/mo" }, { value: "70", label: "Content/mo" }],
    groups: [
      { label: "Analytics & Intelligence", icon: <BarChart2 className="w-3 h-3" />, isVideo: false, items: ["3 Website Re-analyses / month", "2 Competitor Reports / month", "1 Marketing Strategy / month", "3 AI Customer Personas / month"] },
      { label: "Content Studio", icon: <FileText className="w-3 h-3" />, isVideo: false, items: ["50 Social Posts / month", "10 Email Campaigns / month", "10 AI Ad Creatives / month"] },
      { label: "Video Studio", icon: <Video className="w-3 h-3" />, isVideo: true, items: ["AI Video Generation", "8 min 1080p / month", "Up to 32 × 15-sec or 8 × 1-min"] },
      { label: "Performance", icon: <TrendingUp className="w-3 h-3" />, isVideo: false, items: ["1 AI Campaign Report / month"] },
      { label: "Forge AI Agent", icon: <Bot className="w-3 h-3" />, isVideo: false, items: ["200 Forge AI Chats / month", "Full Analytics Dashboard"] },
    ],
  },
  {
    name: "Get-Going", price: 99, color: "#00D4FF", highlight: true, highlightLabel: "Most Popular",
    desc: "For growing creators ready to scale",
    stats: [{ value: "3", label: "Projects" }, { value: "16+2 min", label: "1080p+4K/mo" }, { value: "160", label: "Content/mo" }],
    groups: [
      { label: "Analytics & Intelligence", icon: <BarChart2 className="w-3 h-3" />, isVideo: false, items: ["8 Website Re-analyses / month", "6 Competitor Reports / month", "3 Marketing Strategies / month", "10 AI Customer Personas / month"] },
      { label: "Content Studio", icon: <FileText className="w-3 h-3" />, isVideo: false, items: ["100 Social Posts / month", "30 Email Campaigns / month", "30 AI Ad Creatives / month"] },
      { label: "Video Studio", icon: <Video className="w-3 h-3" />, isVideo: true, items: ["AI Video Generation", "16 min 1080p — up to 64 × 15-sec", "2 min 4K — up to 8 × 15-sec premium"] },
      { label: "Performance", icon: <TrendingUp className="w-3 h-3" />, isVideo: false, items: ["2 AI Campaign Reports / month", "AI Campaign Builder ✓", "Social Scheduling ✓"] },
      { label: "Forge AI Agent", icon: <Bot className="w-3 h-3" />, isVideo: false, items: ["600 Forge AI Chats / month", "Priority Support"] },
    ],
  },
  {
    name: "Growth", price: 249, color: "#14F195", highlight: false,
    desc: "For teams serious about growth",
    stats: [{ value: "6", label: "Projects" }, { value: "50+8 min", label: "1080p+4K/mo" }, { value: "320", label: "Content/mo" }],
    groups: [
      { label: "Analytics & Intelligence", icon: <BarChart2 className="w-3 h-3" />, isVideo: false, items: ["15 Website Re-analyses / month", "12 Competitor Reports / month", "6 Marketing Strategies / month", "20 AI Customer Personas / month", "Competitor Video Mining"] },
      { label: "Content Studio", icon: <FileText className="w-3 h-3" />, isVideo: false, items: ["200 Social Posts / month", "60 Email Campaigns / month", "60 AI Ad Creatives / month"] },
      { label: "Video Studio", icon: <Video className="w-3 h-3" />, isVideo: true, items: ["AI Video Generation", "50 min 1080p — up to 200 × 15-sec", "8 min 4K — up to 32 × 15-sec premium"] },
      { label: "Performance", icon: <TrendingUp className="w-3 h-3" />, isVideo: false, items: ["5 AI Campaign Reports / month", "AI Campaign Builder ✓", "Social Scheduling ✓", "White-Label Reports", "Dedicated Onboarding"] },
      { label: "Forge AI Agent", icon: <Bot className="w-3 h-3" />, isVideo: false, items: ["1,000 Forge AI Chats / month"] },
    ],
  },
  {
    name: "Agency", price: 599, color: "#FF6B35", highlight: false, highlightLabel: "Best Value",
    desc: "For agencies managing multiple clients",
    stats: [{ value: "20", label: "Projects" }, { value: "120+20 min", label: "1080p+4K/mo" }, { value: "640", label: "Content/mo" }],
    groups: [
      { label: "Analytics & Intelligence", icon: <BarChart2 className="w-3 h-3" />, isVideo: false, items: ["30 Website Re-analyses / month", "25 Competitor Reports / month", "15 Marketing Strategies / month", "50 AI Customer Personas / month"] },
      { label: "Content Studio", icon: <FileText className="w-3 h-3" />, isVideo: false, items: ["400 Social Posts / month", "120 Email Campaigns / month", "120 AI Ad Creatives / month"] },
      { label: "Video Studio", icon: <Video className="w-3 h-3" />, isVideo: true, items: ["AI Video Generation", "120 min 1080p — up to 480 × 15-sec", "20 min 4K — up to 80 × 15-sec premium"] },
      { label: "Performance", icon: <TrendingUp className="w-3 h-3" />, isVideo: false, items: ["10 AI Campaign Reports / month", "AI Campaign Builder ✓", "Social Scheduling ✓", "AI Managed Campaigns (Coming Soon)", "Autonomous Growth Mode (Coming Soon)", "White-Label Reports"] },
      { label: "Agency Tools", icon: <Users2 className="w-3 h-3" />, isVideo: false, items: ["4,000 Forge AI Chats / month", "Team Members", "Dedicated Success Manager"] },
    ],
  },
];

const FAQ = [
  { q: "What is GrowthForge?", a: "GrowthForge is an AI Growth Operating System built by Strapli Technologies. You paste your business website URL and it builds your entire marketing department in minutes — competitive intelligence, brand strategy, social and email content, video campaigns, ad creatives, and an AI agent that can execute tasks on demand. It replaces tools and headcount that would otherwise cost $150K+ per year." },
  { q: "How does GrowthForge work?", a: "Three steps: (1) Paste your website URL. (2) GrowthForge's AI reads your site, discovers your top competitors, identifies market gaps, and builds a complete marketing strategy tailored to your brand. (3) Use the strategy to generate content, videos, campaigns, and more — all in one place. No setup, no learning curve." },
  { q: "Do I need marketing experience?", a: "No. GrowthForge is built for founders, operators, and lean teams who want results without needing to hire a marketing director. The platform handles strategy, positioning, and execution — you just review and publish." },
  { q: "What plans are available?", a: "GrowthForge offers four paid tiers: Starter ($39/mo, 1 project, 8 min 1080p video), Get-Going ($99/mo, 3 projects, 16 min 1080p + 2 min 4K video), Growth ($249/mo, 6 projects, 50 min 1080p + 8 min 4K video), and Agency ($599/mo, 20 projects, 120 min 1080p + 20 min 4K video). All plans include AI video generation. Start with a free 14-day trial — no credit card required." },
  { q: "Can I analyze competitors?", a: "Yes. GrowthForge automatically discovers your top competitors, analyzes their positioning, identifies weaknesses in their messaging, and generates a full competitive report — including exactly how to position your brand to win against each one." },
  { q: "Can I generate written content?", a: "Yes. GrowthForge generates social media posts, email campaigns, ad copy, and ad creatives — all grounded in your actual business analysis and brand voice. Content is produced in batches so you always have a pipeline ready to publish." },
  { q: "How does video generation work?", a: "On the free trial, GrowthForge generates complete Video Blueprints — concept, hook, storyboard, scene-by-scene breakdown, voiceover script, and CTA — production-ready for any video creator. On paid plans, GrowthForge renders the actual video in 1080p (and 4K on higher tiers) using your brand assets, ready to post directly. Each plan includes a set number of rendered minutes per month (e.g. 8 min 1080p + 1 min 4K on Get-Going)." },
  { q: "What is Forge AI and what can it do?", a: "Forge AI is GrowthForge's built-in AI agent — it's not a generic chatbot. It knows your business, your competitors, your strategy, and your content history. You can ask it to generate new social posts, draft an email campaign, produce video concepts, or surface competitor insights. It executes tasks using the same AI pipelines as the platform's core tools, so everything it produces is grounded in your real business data." },
  { q: "What happens during the free trial?", a: "The 14-day free trial gives you real access to the core platform — business analysis, competitor discovery, customer personas, marketing strategy, and Forge AI. Content and video outputs during the trial are quota-limited so you can fully evaluate the platform before committing. No credit card is required to start." },
  { q: "Can I cancel or change plans later?", a: "Yes. You can upgrade, downgrade, or cancel at any time from your account settings. Cancellations take effect at the end of the current billing period and you keep access until then. See our Refund Policy for eligibility details." },
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

const APP_NAV_LINKS = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/dashboard", icon: Brain },
  { label: "Forge AI", href: "/dashboard", icon: Bot },
  { label: "Analytics", href: "/dashboard", icon: BarChart2 },
];

const ADMIN_NAV_LINKS = [
  { label: "Admin Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users2 },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart2 },
];

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState("Analysis");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  const isAuthed = isLoaded && !!user;
  const { isAdmin } = useCurrentUser();

  // Persistence: a signed-in admin/super_admin revisiting the marketing homepage
  // should land in the Admin Console, not the public landing page.
  useEffect(() => {
    if (isAuthed && isAdmin) {
      setLocation("/admin", { replace: true });
    }
  }, [isAuthed, isAdmin, setLocation]);

  const W = "max-w-[1380px] mx-auto";

  return (
    <div className="min-h-screen text-foreground overflow-x-hidden" style={{ background: "#040B14" }}>

      {/* ── Nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/8 px-4 sm:px-6 lg:px-8" style={{ background: "rgba(4,11,20,0.85)", backdropFilter: "blur(16px)" }}>
        <div className={`${W} h-16 flex items-center justify-between`}>
          {/* Logo — routes to /admin for admins, /dashboard when signed in, / when not */}
          <Link href={isAdmin ? "/admin" : isAuthed ? "/dashboard" : "/"} className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#00E676]/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-[#00E676]" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">GrowthForge</span>
          </Link>

          {isAuthed ? (
            /* ── Authenticated nav ── */
            <>
              <div className="hidden md:flex items-center gap-6 text-sm text-white/50">
                {(isAdmin ? ADMIN_NAV_LINKS : APP_NAV_LINKS).map(({ label, href, icon: Icon }) => (
                  <Link key={label} href={href} className="flex items-center gap-1.5 hover:text-white transition-colors">
                    <Icon className="h-3.5 w-3.5" />{label}
                  </Link>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <UserButton appearance={{
                  variables: { colorPrimary: "#00E676", colorText: "#ffffff" },
                  elements: {
                    userButtonPopoverActionButtonText: { color: "#FFD600" },
                    userButtonPopoverActionButtonIcon: { color: "#FFD600" },
                  },
                }}>
                  {isAdmin && (
                    <UserButton.MenuItems>
                      <UserButton.Link
                        label="👑 Admin Console"
                        href="/admin"
                        labelIcon={<Crown className="h-4 w-4" />}
                      />
                    </UserButton.MenuItems>
                  )}
                </UserButton>
                <button
                  onClick={() => setMobileNavOpen(true)}
                  className="md:hidden flex items-center justify-center h-9 w-9 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>
            </>
          ) : (
            /* ── Public nav ── */
            <>
              <div className="hidden md:flex items-center gap-7 text-sm text-white/50">
                {NAV_LINKS.map(({ label, href }) =>
                  href.startsWith("#")
                    ? <a key={label} href={href} className="hover:text-white transition-colors">{label}</a>
                    : <Link key={label} href={href} className="hover:text-white transition-colors">{label}</Link>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Link href="/sign-in" className="text-sm text-white/50 hover:text-white transition-colors hidden md:block">Sign In</Link>
                <Link href="/sign-up" className="text-sm font-bold px-4 py-2 rounded-lg text-black transition-all hover:scale-[1.02] hidden sm:inline-flex" style={{ background: "#00E676" }}>
                  Start Free
                </Link>
                <button
                  onClick={() => setMobileNavOpen(true)}
                  className="md:hidden flex items-center justify-center h-9 w-9 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* ── Mobile Nav Sheet ── */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="right"
          className="w-[80vw] max-w-sm border-l border-white/10 p-0 flex flex-col"
          style={{ background: "#040B14" }}
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <div className="flex items-center gap-2.5 px-6 py-5 border-b border-white/8">
            <div className="h-8 w-8 rounded-lg bg-[#00E676]/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-[#00E676]" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">GrowthForge</span>
          </div>

          <div className="flex flex-col gap-1 px-3 py-4 flex-1 overflow-y-auto">
            {isAuthed
              ? (isAdmin ? ADMIN_NAV_LINKS : APP_NAV_LINKS).map(({ label, href, icon: Icon }) => (
                  <Link
                    key={label}
                    href={href}
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-base text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Icon className="h-4 w-4" />{label}
                  </Link>
                ))
              : NAV_LINKS.map(({ label, href }) =>
                  href.startsWith("#") ? (
                    <a
                      key={label}
                      href={href}
                      onClick={() => setMobileNavOpen(false)}
                      className="px-3 py-3 rounded-xl text-base text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      {label}
                    </a>
                  ) : (
                    <Link
                      key={label}
                      href={href}
                      onClick={() => setMobileNavOpen(false)}
                      className="px-3 py-3 rounded-xl text-base text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      {label}
                    </Link>
                  )
                )}
          </div>

          <div className="flex flex-col gap-3 p-4 border-t border-white/8">
            {isAuthed ? (
              <button
                onClick={() => {
                  setMobileNavOpen(false);
                  signOut(() => setLocation("/"));
                }}
                className="w-full text-center text-sm font-semibold px-4 py-3 rounded-xl text-white/70 border border-white/10 hover:text-white hover:bg-white/5 transition-colors"
              >
                Sign Out
              </button>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  onClick={() => setMobileNavOpen(false)}
                  className="w-full text-center text-sm font-semibold px-4 py-3 rounded-xl text-white/70 border border-white/10 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  onClick={() => setMobileNavOpen(false)}
                  className="w-full text-center text-sm font-bold px-4 py-3 rounded-xl text-black transition-all"
                  style={{ background: "#00E676" }}
                >
                  Start Free
                </Link>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
            {isAuthed ? (
              <Link href="/dashboard" className="w-full sm:w-auto flex items-center justify-center gap-2 font-bold text-base px-8 py-4 rounded-xl transition-all shadow-lg hover:scale-[1.02] text-black"
                style={{ background: "#00E676", boxShadow: "0 0 40px rgba(0,230,118,0.25)" }}>
                Go To Dashboard <ArrowRight className="h-5 w-5" />
              </Link>
            ) : (
              <Link href="/sign-up" className="w-full sm:w-auto flex items-center justify-center gap-2 font-bold text-base px-8 py-4 rounded-xl transition-all shadow-lg hover:scale-[1.02] text-black"
                style={{ background: "#00E676", boxShadow: "0 0 40px rgba(0,230,118,0.25)" }}>
                Start Free Trial <ArrowRight className="h-5 w-5" />
              </Link>
            )}
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <FadeIn delay={0.1}>
              <DashboardMockup active="Videos" />
            </FadeIn>
            <FadeIn>
              <SectionLabel>Video Studio</SectionLabel>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-white mb-4">Create Marketing Videos Faster</h2>
              <p className="text-white/50 text-lg leading-relaxed mb-4">
                GrowthForge generates and renders marketing videos ready to post. Scripts, storyboards, and full production — no editing experience required.
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-[#00E676]/30 bg-[#00E676]/10">
              <Check className="w-4 h-4 text-[#00E676] shrink-0" />
              <span className="text-[#00E676] text-sm font-semibold">All plans include a 14-day free trial — no credit card required</span>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {PRICING.map((plan, i) => (
              <FadeIn key={plan.name} delay={i * 0.08}>
                <div
                  className="relative flex flex-col rounded-2xl overflow-hidden h-full"
                  style={{
                    border: plan.highlight ? `1.5px solid ${plan.color}50` : "1.5px solid rgba(255,255,255,0.07)",
                    background: plan.highlight ? `linear-gradient(160deg, ${plan.color}0d 0%, #080f1e 40%)` : "#080f1e",
                    boxShadow: plan.highlight ? `0 0 40px ${plan.color}18` : "none",
                  }}
                >
                  {/* Colored top bar */}
                  <div className="h-1 w-full shrink-0" style={{ background: `linear-gradient(90deg, ${plan.color}, ${plan.color}44)` }} />

                  {/* Badge */}
                  {plan.highlightLabel && (
                    <div
                      className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-[11px] font-bold"
                      style={{ background: `${plan.color}22`, color: plan.color, border: `1px solid ${plan.color}44` }}
                    >
                      {plan.highlightLabel}
                    </div>
                  )}

                  <div className="flex flex-col flex-1 p-5 gap-4">
                    {/* Header */}
                    <div>
                      <div className="text-lg font-bold text-white mb-0.5">{plan.name}</div>
                      <div className="text-xs text-white/40 mb-3">{plan.desc}</div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-white">${plan.price}</span>
                        <span className="text-white/40 text-sm">/mo</span>
                      </div>
                      <div className="text-white/25 text-[11px] mt-0.5">Billed monthly · Cancel anytime</div>
                    </div>

                    {/* Hero stats */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {plan.stats.map((s: { value: string; label: string }) => (
                        <div
                          key={s.label}
                          className="flex flex-col items-center justify-center rounded-xl py-2 px-1 text-center"
                          style={{ background: `${plan.color}10`, border: `1px solid ${plan.color}22` }}
                        >
                          <span className="text-sm font-bold leading-tight" style={{ color: plan.color }}>{s.value}</span>
                          <span className="text-[10px] text-white/40 leading-tight mt-0.5">{s.label}</span>
                        </div>
                      ))}
                    </div>

                    {/* Feature groups */}
                    <div className="flex flex-col gap-3 flex-1">
                      {plan.groups.map((g: { label: string; icon: React.ReactNode; isVideo: boolean; items: string[] }) => (
                        <div key={g.label}>
                          <div className="flex items-center gap-1.5 mb-1.5 pb-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                            <span style={{ color: g.isVideo ? plan.color : "rgba(255,255,255,0.3)" }}>{g.icon}</span>
                            <span
                              className="text-[10px] font-semibold tracking-wider uppercase"
                              style={{ color: g.isVideo ? plan.color : "rgba(255,255,255,0.3)" }}
                            >{g.label}</span>
                          </div>
                          <ul className="flex flex-col gap-1">
                            {g.items.map((item: string, idx: number) => {
                              const isSub = item.startsWith("Up to") || item.startsWith("up to");
                              return (
                                <li key={idx} className={`flex items-start gap-1.5 ${isSub ? "pl-4" : ""}`}>
                                  {!isSub && <Check className="w-3 h-3 shrink-0 mt-0.5" style={{ color: g.isVideo ? plan.color : "rgba(255,255,255,0.3)" }} />}
                                  {isSub && <span className="text-white/25 text-xs shrink-0">↳</span>}
                                  <span className={`text-xs leading-relaxed ${isSub ? "text-white/30 italic" : "text-white/60"}`}>{item}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>

                    {/* CTA */}
                    <div className="flex flex-col gap-1.5 pt-1">
                      <Link
                        href="/sign-up"
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.99]"
                        style={plan.highlight
                          ? { background: plan.color, color: "#040B14", boxShadow: `0 4px 20px ${plan.color}44` }
                          : { background: "transparent", color: plan.color, border: `1.5px solid ${plan.color}44` }
                        }
                      >
                        <ArrowRight className="w-3.5 h-3.5" /> Start Free Trial
                      </Link>
                      <p className="text-center text-[10px] text-white/20">14-day free trial · No credit card required</p>
                    </div>
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
        <div className="max-w-[760px] mx-auto">
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

    </div>
  );
}
