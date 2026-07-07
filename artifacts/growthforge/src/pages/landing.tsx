import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { motion, useInView } from "framer-motion";
import {
  Brain, Video, Target, BarChart2, Zap, ArrowRight, Check,
  Users2, FileText, Share2, Mail, Bot, Star,
} from "lucide-react";

const features = [
  { icon: Brain, title: "Business Intelligence", desc: "AI scans your website and extracts your business model, ICP, pain points, opportunities, and competitive landscape in seconds." },
  { icon: Users2, title: "Competitor Intelligence", desc: "Discover and analyze your top competitors. Identify market gaps, messaging weaknesses, and your exact winning positioning." },
  { icon: FileText, title: "Content Engine", desc: "Generate blog posts, whitepapers, case studies, and SEO content tailored to your brand voice and ICP." },
  { icon: Video, title: "Video Studio", desc: "Create 9 professional marketing videos — promos, product demos, TikTok shorts — with scripts and storyboards." },
  { icon: Share2, title: "Social Media Hub", desc: "30 days of platform-optimized social posts across LinkedIn, Instagram, TikTok, and X. One click, ready to publish." },
  { icon: Mail, title: "Email Campaigns", desc: "Welcome sequences, sales flows, nurture campaigns, and reactivation emails — all personalized to your funnel." },
  { icon: Target, title: "Campaign Manager", desc: "AI-managed ad campaigns across Google, Meta, and LinkedIn. Autonomous optimization 24/7." },
  { icon: Bot, title: "AI Marketing Agent", desc: "Chat with your AI marketing agent. Say 'Generate 15 TikTok videos' and watch it happen." },
  { icon: BarChart2, title: "Analytics & Reports", desc: "Real-time performance dashboards with AI-generated insights and recommendations." },
];

const steps = [
  { num: "01", title: "Paste Your URL", desc: "Drop your website URL into GrowthForge at UseGrowthForge.com. Our AI reads and understands your entire business in seconds." },
  { num: "02", title: "AI Builds Your Department", desc: "Within minutes, you have a complete marketing department: strategy, content, videos, ads, emails, and campaigns." },
  { num: "03", title: "Launch & Grow Autonomously", desc: "Review your assets, hit launch, and let AI optimize your campaigns, content, and growth 24/7." },
];

const testimonials = [
  { name: "Sarah K.", role: "Founder, B2B SaaS", quote: "I canceled my $9,500/month marketing agency in week 1. GrowthForge does everything they did — and it ships 10x faster.", stars: 5 },
  { name: "Marcus R.", role: "Agency Owner", quote: "I now serve 4x more clients without hiring anyone. The video generation alone saved me $40K in production costs last quarter.", stars: 5 },
  { name: "Priya M.", role: "VP Marketing", quote: "We went from 2 blog posts a month to 30. Our organic traffic is up 340% in 90 days. This tool is unprecedented.", stars: 5 },
];

const pricing = [
  { name: "Starter", price: 99, features: ["1 project", "Content Engine", "Competitor analysis", "Email campaigns", "10 videos/month", "Analytics dashboard"], cta: "Start Free Trial", highlight: false },
  { name: "Growth", price: 299, features: ["5 projects", "Everything in Starter", "30 videos/month", "AI Agent chat", "Autonomous campaigns", "Priority support"], cta: "Start Free Trial", highlight: true },
  { name: "Agency", price: 799, features: ["Unlimited projects", "Everything in Growth", "Unlimited videos", "White-label reports", "Team collaboration", "Dedicated success manager"], cta: "Book a Demo", highlight: false },
];

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <span className="font-bold text-lg tracking-tight">GrowthForge</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how" className="hover:text-foreground transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden md:block">Sign In</Link>
            <Link href="/dashboard" className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              Start Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 relative overflow-hidden">
        {/* Glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-[600px] w-[900px] rounded-full bg-primary/8 blur-[120px]" />
        </div>
        <div className="max-w-5xl mx-auto text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-8">
              <Zap className="h-3 w-3" />
              AI-Powered Marketing OS
            </span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl md:text-7xl font-black tracking-tighter text-foreground leading-[1.05] mb-6"
          >
            Paste Your URL.<br />
            <span className="text-primary">Get Your Marketing</span><br />
            Department.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            GrowthForge analyzes your business and delivers a complete marketing team in minutes — strategy, content, videos, ads, email campaigns, and autonomous AI agents that work 24/7.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/dashboard" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base px-8 py-4 rounded-xl transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02]">
              Start Free Analysis
              <ArrowRight className="h-5 w-5" />
            </Link>
            <a href="#features" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 text-foreground font-semibold text-base px-8 py-4 rounded-xl border border-border transition-colors">
              See All Features
            </a>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-6 text-sm text-muted-foreground"
          >
            No credit card required · Free 14-day trial · Cancel anytime
          </motion.p>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
            className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto"
          >
            {[
              { value: "10,000+", label: "Businesses on GrowthForge" },
              { value: "340%", label: "Average Traffic Growth" },
              { value: "9x", label: "More Content Output" },
              { value: "$120K", label: "Average Annual Savings" },
            ].map(({ value, label }) => (
              <div key={label} className="rounded-xl bg-card border border-border p-4 text-center">
                <div className="text-2xl font-black text-primary mb-1">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how" className="py-24 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-4xl font-black tracking-tight mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg">From URL to full marketing department in under 10 minutes.</p>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map(({ num, title, desc }, i) => (
              <FadeIn key={num} delay={i * 0.12}>
                <div className="relative p-6 rounded-2xl bg-card border border-border hover:border-primary/40 transition-colors group">
                  <div className="text-5xl font-black text-primary/20 group-hover:text-primary/40 transition-colors mb-4 font-mono">{num}</div>
                  <h3 className="text-lg font-bold mb-2">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-4xl font-black tracking-tight mb-4">Everything a Marketing Team Does</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">One platform that replaces strategy consultants, content writers, video producers, ad managers, and data analysts.</p>
          </FadeIn>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map(({ icon: Icon, title, desc }, i) => (
              <FadeIn key={title} delay={i * 0.07}>
                <div className="p-6 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all group hover:bg-card/80">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-bold mb-2 text-foreground">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-4xl font-black tracking-tight mb-4">Built for Growth Teams</h2>
            <p className="text-muted-foreground text-lg">Join thousands of founders and marketers who replaced their agencies.</p>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map(({ name, role, quote, stars }, i) => (
              <FadeIn key={name} delay={i * 0.12}>
                <div className="p-6 rounded-2xl bg-card border border-border flex flex-col gap-4">
                  <div className="flex gap-0.5">
                    {Array.from({ length: stars }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-foreground text-sm leading-relaxed italic">"{quote}"</p>
                  <div className="mt-auto">
                    <div className="font-semibold text-sm">{name}</div>
                    <div className="text-xs text-muted-foreground">{role}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-4xl font-black tracking-tight mb-4">Simple, Transparent Pricing</h2>
            <p className="text-muted-foreground text-lg">Replace a $120K/year marketing team for a fraction of the cost.</p>
          </FadeIn>
          <div className="grid md:grid-cols-3 gap-6">
            {pricing.map(({ name, price, features: feats, cta, highlight }, i) => (
              <FadeIn key={name} delay={i * 0.1}>
                <div className={`p-8 rounded-2xl border flex flex-col gap-6 ${highlight ? "bg-primary/10 border-primary shadow-lg shadow-primary/10" : "bg-card border-border"}`}>
                  {highlight && <div className="text-xs font-bold uppercase tracking-widest text-primary">Most Popular</div>}
                  <div>
                    <div className="text-xl font-bold mb-1">{name}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black">${price}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </div>
                  <ul className="space-y-3 flex-1">
                    {feats.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className={`h-4 w-4 shrink-0 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
                        <span className="text-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/dashboard" className={`w-full text-center py-3 rounded-xl font-bold text-sm transition-all ${highlight ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20" : "bg-secondary hover:bg-secondary/80 text-foreground border border-border"}`}>
                    {cta}
                  </Link>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <FadeIn className="text-center mb-12">
            <h2 className="text-4xl font-black tracking-tight mb-4">Frequently Asked Questions</h2>
          </FadeIn>
          <div className="space-y-4">
            {[
              { q: "How long does the initial analysis take?", a: "The AI completes a full business intelligence analysis, competitor research, and marketing strategy in under 5 minutes. Videos and content can be generated immediately after." },
              { q: "Is the content actually good quality?", a: "Our AI is trained specifically on high-converting marketing content. Every piece is tailored to your brand voice, ICP, and industry — not generic templates." },
              { q: "Can I edit the AI-generated content?", a: "Yes. Everything is fully editable. Think of GrowthForge as a starting point that gets you 90% there instantly. You review, refine, and approve." },
              { q: "What makes GrowthForge different from other AI tools?", a: "Other tools do one thing (write copy, or make images). GrowthForge by Strapli Technologies is a complete marketing operating system — from business intelligence to campaign management, everything is connected and works together." },
              { q: "Do I need a marketing background to use it?", a: "No. GrowthForge is designed for founders and operators who want results without needing to know marketing strategy. Paste your URL and follow the guided flow." },
            ].map(({ q, a }, i) => (
              <FadeIn key={q} delay={i * 0.08}>
                <div className="p-6 rounded-xl bg-card border border-border">
                  <h3 className="font-bold mb-2">{q}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-[300px] w-[600px] rounded-full bg-primary/10 blur-[80px]" />
          </div>
          <FadeIn>
            <h2 className="text-5xl font-black tracking-tighter mb-4 relative">Your Marketing Department<br />Starts Now.</h2>
            <p className="text-muted-foreground text-lg mb-8 relative">No agency fees. No hiring. No waiting months for results. Just paste your URL.</p>
            <Link href="/dashboard" className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg px-10 py-5 rounded-xl transition-all shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02] relative">
              Start Your Free Analysis
              <ArrowRight className="h-5 w-5" />
            </Link>
            <p className="mt-4 text-sm text-muted-foreground relative">Free 14-day trial · No credit card required</p>
          </FadeIn>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-primary/20 flex items-center justify-center">
              <Zap className="h-3 w-3 text-primary" />
            </div>
            <span className="font-bold text-sm">GrowthForge</span>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-2 md:gap-6 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} Strapli Technologies Inc. All rights reserved.</span>
            <a href="https://usegrowthforge.com" className="hover:text-foreground transition-colors">UseGrowthForge.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
