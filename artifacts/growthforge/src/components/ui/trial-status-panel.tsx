import { Link } from "wouter";
import { motion } from "framer-motion";
import { Zap, Check, ArrowRight } from "lucide-react";
import { useTrialUsage } from "@/hooks/use-trial-usage";

interface TrialStatusPanelProps {
  projectId: number;
  trialEndsAt?: string | null;
  subscriptionStatus?: string;
  collapsed?: boolean;
}

const METERS = [
  { key: "analyses" as const, label: "Analyses", limit: 1 },
  { key: "competitors" as const, label: "Competitors", limit: 2 },
  { key: "strategies" as const, label: "Strategy", limit: 1 },
  { key: "socialPosts" as const, label: "Social Posts", limit: 5 },
  { key: "emailCampaigns" as const, label: "Emails", limit: 1 },
  { key: "videoBlueprints" as const, label: "Video Blueprints", limit: 1 },
  { key: "agentMessages" as const, label: "AI Messages", limit: 10 },
];

const CHECKLIST = [
  { key: "analyses" as const, label: "Website Analyzed" },
  { key: "competitors" as const, label: "Competitors Reviewed" },
  { key: "strategies" as const, label: "Strategy Generated" },
  { key: "socialPosts" as const, label: "Social Content Created" },
  { key: "emailCampaigns" as const, label: "Email Campaign Created" },
  { key: "videoBlueprints" as const, label: "Video Blueprint Created" },
  { key: "agentMessages" as const, label: "Forge AI Used" },
];

export function TrialStatusPanel({ projectId, trialEndsAt, subscriptionStatus, collapsed }: TrialStatusPanelProps) {
  const { usage } = useTrialUsage(projectId);

  if (subscriptionStatus !== "trial") return null;

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 14;

  if (collapsed) {
    const doneItems = usage ? CHECKLIST.filter((c) => (usage[c.key] ?? 0) > 0).length : 0;
    const pct = Math.round((doneItems / CHECKLIST.length) * 100);
    return (
      <div className="px-2 pb-3">
        <Link
          href="/plans"
          title={`Trial: ${daysLeft}d left · ${pct}% activated`}
          className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[#00E676]/8 border border-[#00E676]/20 hover:bg-[#00E676]/15 transition-colors"
        >
          <Zap className="w-4 h-4 text-[#00E676]" />
          <div className="w-8 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-[#00E676]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[9px] text-[#00E676]/70 font-medium">{daysLeft}d left</span>
        </Link>
      </div>
    );
  }

  const totalChecked = usage ? CHECKLIST.filter((c) => (usage[c.key] ?? 0) > 0).length : 0;
  const activationPct = Math.round((totalChecked / CHECKLIST.length) * 100);

  return (
    <div className="px-3 pb-3">
      <div className="rounded-xl border border-[#00E676]/20 bg-[#061811] overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2.5 bg-[#00E676]/8 border-b border-[#00E676]/15 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-[#00E676]" />
            <span className="text-[11px] font-bold text-[#00E676] uppercase tracking-wider">Trial Active</span>
          </div>
          <span className="text-[11px] font-semibold text-white/60">{daysLeft}d left</span>
        </div>

        {/* Usage meters */}
        {usage && (
          <div className="px-3 pt-2.5 pb-2 flex flex-col gap-2">
            {METERS.map(({ key, label, limit }) => {
              const used = usage[key] ?? 0;
              const pct = Math.min(100, (used / limit) * 100);
              const full = used >= limit;
              return (
                <div key={key}>
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-[10px] text-white/50">{label}</span>
                    <span className={`text-[10px] font-semibold ${full ? "text-amber-400" : "text-white/60"}`}>
                      {used}/{limit}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      style={{ background: full ? "#f59e0b" : "linear-gradient(90deg, #00E676, #00D4FF)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Activation checklist */}
        <div className="px-3 pb-2 border-t border-white/5 pt-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-white/40 uppercase tracking-wider">Activation</span>
            <span className="text-[10px] font-semibold text-[#00E676]">{activationPct}%</span>
          </div>
          <div className="flex flex-col gap-1">
            {CHECKLIST.map(({ key, label }) => {
              const done = (usage?.[key] ?? 0) > 0;
              return (
                <div key={key} className={`flex items-center gap-1.5 text-[10px] ${done ? "text-white/70" : "text-white/30"}`}>
                  <div className={`w-3 h-3 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-[#00E676] text-black" : "border border-white/15"}`}>
                    {done && <Check className="w-2 h-2" />}
                  </div>
                  {label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Upgrade CTA */}
        <div className="px-3 pb-3">
          <Link
            href="/plans"
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[#00E676] text-black text-[11px] font-bold hover:bg-[#14F195] transition-colors"
          >
            <ArrowRight className="w-3 h-3" /> Upgrade Now
          </Link>
        </div>
      </div>
    </div>
  );
}
