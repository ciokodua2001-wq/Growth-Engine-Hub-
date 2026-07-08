import { Brain, Zap, DollarSign, MessageSquare } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";
import StatCard from "@/components/admin/stat-card";

const METRICS = [
  { label: "Business Analyses", count: 0, color: "#00E676" },
  { label: "Competitor Reports", count: 0, color: "#00D4FF" },
  { label: "Email Campaigns", count: 0, color: "#14F195" },
  { label: "Social Posts", count: 0, color: "#a78bfa" },
  { label: "Video Blueprints", count: 0, color: "#f59e0b" },
  { label: "Agent Messages", count: 0, color: "#00E676" },
];

export default function AdminAI() {
  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">AI Usage</h1>
          <p className="text-white/40 text-sm mt-0.5">Token consumption and cost tracking</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Requests" value="0" icon={<Brain className="w-5 h-5" />} color="#00E676" />
          <StatCard label="Tokens Used" value="0" icon={<Zap className="w-5 h-5" />} color="#00D4FF" />
          <StatCard label="Est. Cost" value="$0.00" icon={<DollarSign className="w-5 h-5" />} color="#14F195" />
          <StatCard label="Avg / User" value="0" icon={<MessageSquare className="w-5 h-5" />} color="#a78bfa" />
        </div>

        <div>
          <h2 className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-4">By Generation Type</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {METRICS.map(({ label, count, color }) => (
              <div key={label} className="p-5 rounded-2xl border border-white/8 hover:border-white/15 transition-all"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">{label}</span>
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                </div>
                <div className="text-3xl font-black text-white mb-1">{count}</div>
                <div className="text-xs text-white/20">generated total</div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
          <div className="text-amber-400 font-semibold text-sm mb-1">AI Usage Tracking Not Yet Active</div>
          <div className="text-white/40 text-sm">Connect OpenAI usage logging to track token consumption, costs, and generation counts per user.</div>
        </div>
      </div>
    </AdminLayout>
  );
}
