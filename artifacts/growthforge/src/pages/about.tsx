import { Link } from "wouter";
import { Zap, ArrowLeft, Target, Lightbulb, Rocket, Heart } from "lucide-react";
import { motion } from "framer-motion";

export default function AboutPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: "#040B14" }}>
      <nav className="border-b border-white/8 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[#00E676]/20 flex items-center justify-center"><Zap className="h-3.5 w-3.5 text-[#00E676]" /></div>
            <span className="font-bold text-white">GrowthForge</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to home
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">

        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] text-xs font-bold mb-5">
            <Zap className="w-3 h-3" /> About GrowthForge
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white mb-6">
            We Built the Marketing<br />
            <span style={{ color: "#00E676" }}>Department You Can't Afford.</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            GrowthForge was created because great marketing shouldn't be reserved for companies with $100K budgets.
          </p>
        </motion.div>

        {/* Values */}
        <div className="grid md:grid-cols-2 gap-6 mb-20">
          {[
            { icon: Target, title: "Mission", desc: "To democratize marketing intelligence. Every business — regardless of size or budget — deserves access to the strategic insights and execution capability of a world-class marketing team." },
            { icon: Lightbulb, title: "Vision", desc: "A world where any founder, operator, or team can launch, grow, and scale their business without being held back by marketing complexity, cost, or expertise gaps." },
            { icon: Rocket, title: "Why GrowthForge Exists", desc: "The average marketing agency costs $5,000–$20,000 per month. Most small businesses and startups can't afford that — yet they need the same strategic output to compete and grow. GrowthForge closes that gap entirely." },
            { icon: Heart, title: "Built for Builders", desc: "GrowthForge is for the founders who wear 10 hats. The agencies who want to scale. The growth teams who need to move faster. We built the tool we always wished existed." },
          ].map(({ icon: Icon, title, desc }, i) => (
            <motion.div key={title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
              className="p-7 rounded-2xl border border-white/8" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="w-11 h-11 rounded-xl bg-[#00E676]/10 flex items-center justify-center mb-5">
                <Icon className="w-5 h-5 text-[#00E676]" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
              <p className="text-white/50 leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Story */}
        <div className="max-w-3xl mx-auto mb-20">
          <h2 className="text-3xl font-black text-white mb-6">Our Story</h2>
          <div className="space-y-5 text-white/60 leading-relaxed">
            <p>GrowthForge started with a simple observation: the businesses that grow the fastest aren't necessarily better products — they're better marketed. Yet the tools and talent to do marketing well were out of reach for most.</p>
            <p>Strapli Technologies Inc. was founded to change that. We asked: what if AI could do what a full marketing team does — strategy, content, competitor research, video production, campaigns — and make it accessible to anyone?</p>
            <p>The result is GrowthForge: an AI Growth Operating System that transforms a website URL into a complete marketing department in minutes. We handle the strategy, the content, the intelligence, and the execution infrastructure — so you can focus on your business.</p>
            <p>We're building the future of marketing: intelligent, autonomous, and accessible to every business that wants to grow.</p>
          </div>
        </div>

        {/* What We Build */}
        <div className="rounded-2xl border border-[#00E676]/20 p-8 md:p-12 text-center mb-16"
          style={{ background: "linear-gradient(135deg, rgba(0,230,118,0.06) 0%, rgba(4,11,20,1) 100%)" }}>
          <h2 className="text-3xl font-black text-white mb-4">What We're Building</h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            GrowthForge is the AI Growth Operating System. One platform that replaces the strategy consultant, the content writer, the video producer, the ad manager, and the growth analyst — powered entirely by AI.
          </p>
          <Link href="/sign-up" className="inline-flex items-center gap-2 font-bold px-8 py-4 rounded-xl text-black transition-all hover:scale-[1.02]"
            style={{ background: "#00E676" }}>
            Start Free Trial
          </Link>
        </div>

        {/* Company Info */}
        <div className="border-t border-white/8 pt-10 text-center">
          <p className="text-white/30 text-sm">
            GrowthForge is a product of <strong className="text-white/50">Strapli Technologies Inc.</strong><br />
            <a href="mailto:hello@usegrowthforge.com" className="text-[#00E676] hover:underline">hello@usegrowthforge.com</a>
            {" · "}
            <a href="https://usegrowthforge.com" className="text-[#00E676] hover:underline">usegrowthforge.com</a>
          </p>
        </div>
      </main>
    </div>
  );
}
