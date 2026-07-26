import { useState } from "react";
import { Link } from "wouter";
import { Zap, ArrowLeft, Mail, MessageSquare, Clock, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function ContactPage() {
  const [step, setStep] = useState<"form" | "loading" | "done">("form");
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [aiResponse, setAiResponse] = useState<string>("");
  const [escalated, setEscalated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStep("loading");
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Something went wrong. Please try again.");
      }
      const data = await res.json() as { aiResponse?: string; escalated?: boolean };
      setAiResponse(data.aiResponse ?? "We've received your message and will get back to you within 24 hours.");
      setEscalated(!!data.escalated);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStep("form");
    }
  };

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
        <div className="mb-12 text-center">
          <p className="text-[#00E676] text-sm font-semibold mb-2">Get in Touch</p>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">Contact GrowthForge</h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto">We're here to help. Reach out for support, sales inquiries, or partnership opportunities.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-12">
          {[
            { icon: Mail, title: "Support Email", value: "support@usegrowthforge.com", desc: "For account, billing, and technical issues" },
            { icon: MessageSquare, title: "Sales Contact", value: "sales@usegrowthforge.com", desc: "For enterprise plans and demos" },
            { icon: Clock, title: "AI Response", value: "Within seconds", desc: "Our AI agent responds immediately" },
          ].map(({ icon: Icon, title, value, desc }) => (
            <div key={title} className="p-6 rounded-2xl border border-white/8 text-center" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="w-11 h-11 rounded-xl bg-[#00E676]/10 flex items-center justify-center mx-auto mb-4">
                <Icon className="w-5 h-5 text-[#00E676]" />
              </div>
              <h3 className="font-bold text-white mb-1">{title}</h3>
              <p className="text-[#00E676] text-sm font-semibold mb-1">{value}</p>
              <p className="text-white/40 text-xs">{desc}</p>
            </div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-white/8 p-8" style={{ background: "rgba(255,255,255,0.02)" }}>
            <h2 className="text-2xl font-bold text-white mb-6">Send a Message</h2>

            {step === "form" && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {error && (
                  <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
                    {error}
                  </div>
                )}
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm text-white/60 mb-2">Full Name</label>
                    <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Your name" className="w-full px-4 py-3 rounded-xl text-white text-sm focus:outline-none focus:border-[#00E676]/50 placeholder:text-white/20"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  </div>
                  <div>
                    <label className="block text-sm text-white/60 mb-2">Email Address</label>
                    <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="you@company.com" className="w-full px-4 py-3 rounded-xl text-white text-sm focus:outline-none placeholder:text-white/20"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Subject</label>
                  <select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required
                    className="w-full px-4 py-3 rounded-xl text-white text-sm focus:outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <option value="" style={{ background: "#040B14" }}>Select a topic</option>
                    <option value="Technical Support" style={{ background: "#040B14" }}>Technical Support</option>
                    <option value="Billing Question" style={{ background: "#040B14" }}>Billing Question</option>
                    <option value="Sales / Enterprise" style={{ background: "#040B14" }}>Sales / Enterprise</option>
                    <option value="Book a Demo" style={{ background: "#040B14" }}>Book a Demo</option>
                    <option value="Partnership" style={{ background: "#040B14" }}>Partnership</option>
                    <option value="Other" style={{ background: "#040B14" }}>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Message</label>
                  <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="How can we help you?" rows={5}
                    className="w-full px-4 py-3 rounded-xl text-white text-sm focus:outline-none resize-none placeholder:text-white/20"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>
                <button type="submit" className="w-full py-3.5 rounded-xl font-bold text-sm text-black transition-all hover:scale-[1.01]"
                  style={{ background: "#00E676" }}>
                  Send Message
                </button>
              </form>
            )}

            {step === "loading" && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className="w-10 h-10 text-[#00E676] animate-spin" />
                <p className="text-white/50 text-sm">Our AI agent is reviewing your message…</p>
              </div>
            )}

            {step === "done" && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#00E676]/30 bg-[#00E676]/8">
                  <div className="w-8 h-8 rounded-lg bg-[#00E676]/20 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-[#00E676]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">AI Support Agent replied</p>
                    <p className="text-xs text-white/40">A copy has also been sent to {form.email}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <p className="text-xs text-white/40 mb-3 uppercase tracking-wide font-semibold">Response</p>
                  <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{aiResponse}</p>
                </div>

                {escalated && (
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/8">
                    <span className="text-amber-400 text-lg">🔔</span>
                    <p className="text-sm text-amber-300/80">
                      This ticket has been flagged for human review. Our team will follow up with you directly within 24 hours.
                    </p>
                  </div>
                )}

                <button
                  onClick={() => { setStep("form"); setForm({ name: "", email: "", subject: "", message: "" }); setAiResponse(""); setEscalated(false); }}
                  className="text-sm text-white/40 hover:text-white transition-colors border border-white/10 px-5 py-2.5 rounded-xl"
                >
                  Send another message
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
