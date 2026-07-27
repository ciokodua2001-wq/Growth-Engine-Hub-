import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { motion } from "framer-motion";
import { BookOpen, Sparkles, Brain, MessageSquare } from "lucide-react";
import { useState } from "react";

export default function Landing() {
  const { signIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const handleAuth = async () => {
    if (mode === "signin" && signInLoaded && signIn) {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}/z-tutor/sso-callback`,
        redirectUrlComplete: `${window.location.origin}/z-tutor/`,
      });
    } else if (signUpLoaded && signUp) {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}/z-tutor/sso-callback`,
        redirectUrlComplete: `${window.location.origin}/z-tutor/`,
      });
    }
  };

  const features = [
    {
      icon: Brain,
      title: "Curriculum-Aligned AI",
      desc: "Z knows exactly what you're studying and stays on topic — always.",
    },
    {
      icon: Sparkles,
      title: "Hints, Not Answers",
      desc: "Z guides you to discoveries rather than handing you the solution.",
    },
    {
      icon: MessageSquare,
      title: "Natural Conversation",
      desc: "Ask questions the way you'd ask a tutor — plain language, no commands.",
    },
    {
      icon: BookOpen,
      title: "Voice Playback",
      desc: "Listen to explanations read aloud for easier comprehension.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#080B14] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-900/40">
            Z
          </div>
          <div>
            <span className="font-semibold text-white">Quantivarian</span>
            <span className="ml-2 text-xs text-indigo-400 tracking-wider uppercase">AI Tutor</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setMode("signin")}
            className="px-4 py-2 text-sm text-white/70 hover:text-white transition-colors"
          >
            Sign in
          </button>
          <button
            onClick={() => { setMode("signup"); handleAuth(); }}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors"
          >
            Get started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-24 pb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-950/60 border border-indigo-700/40 text-indigo-300 text-sm mb-8">
            <Sparkles className="w-4 h-4" />
            Powered by Claude AI · Aligned to your curriculum
          </div>

          <h1 className="text-6xl md:text-7xl font-bold tracking-tight mb-6">
            <span className="bg-gradient-to-r from-white via-indigo-200 to-violet-300 bg-clip-text text-transparent">
              Meet Z.
            </span>
            <br />
            <span className="text-white/80 text-5xl md:text-6xl font-light">Your AI tutor.</span>
          </h1>

          <p className="text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
            Z knows your grade, your subject, and your lesson. It never gives away the answer — 
            it guides you there, one hint at a time.
          </p>

          <button
            onClick={handleAuth}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-xl text-lg font-medium transition-all shadow-2xl shadow-indigo-900/50 hover:shadow-indigo-700/50 hover:-translate-y-0.5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-20"
        >
          {features.map((f) => (
            <div
              key={f.title}
              className="flex gap-4 p-5 rounded-xl bg-white/[0.03] border border-white/5 text-left hover:bg-white/[0.05] transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-900/60 border border-indigo-700/30 flex items-center justify-center flex-shrink-0">
                <f.icon className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">{f.title}</h3>
                <p className="text-sm text-white/50">{f.desc}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Pricing teaser */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-16 p-8 rounded-2xl bg-gradient-to-br from-indigo-950/40 to-violet-950/40 border border-indigo-700/20"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="text-left">
              <div className="text-indigo-400 text-sm font-medium mb-2">Free</div>
              <div className="text-3xl font-bold text-white mb-1">10 questions</div>
              <div className="text-white/50 text-sm">per session · no card required</div>
            </div>
            <div className="text-left">
              <div className="text-violet-400 text-sm font-medium mb-2">Unlimited</div>
              <div className="text-3xl font-bold text-white mb-1">$9.99<span className="text-lg font-normal text-white/40">/mo</span></div>
              <div className="text-white/50 text-sm">configurable monthly questions</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
