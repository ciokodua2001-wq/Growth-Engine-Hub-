import { Lock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrialGateProps {
  featureName: string;
  description: string;
  className?: string;
}

/** Full-page (or in-modal) upgrade prompt — same CTA used by SEO Strategy for trial-locked features. */
export function TrialGate({ featureName, description, className }: TrialGateProps) {
  return (
    <div className={cn("rounded-2xl border border-white/10 p-8 text-center space-y-4 bg-white/5", className)}>
      <div
        className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center"
        style={{ background: "rgba(0,230,118,0.1)", border: "1px solid rgba(0,230,118,0.2)" }}
      >
        <Lock className="w-6 h-6 text-[#00E676]" />
      </div>
      <div>
        <p className="text-white font-bold text-lg">{featureName}</p>
        <p className="text-white/40 text-sm mt-1 max-w-sm mx-auto">{description}</p>
      </div>
      <a
        href="/plans"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black hover:scale-[1.02] transition-transform"
        style={{ background: "#00E676" }}
      >
        <Zap className="w-4 h-4" /> Upgrade to Unlock
      </a>
    </div>
  );
}
