import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, Users, XCircle } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";
import StatCard from "@/components/admin/stat-card";

interface Stats { totalUsers: number; trialUsers: number; paidUsers: number; cancelledUsers: number; monthlyRevenue: number; annualRevenue: number; }

const PLANS = [
  { name: "Starter", price: 49, color: "#00D4FF" },
  { name: "Growth",  price: 99, color: "#00E676" },
  { name: "Agency",  price: 299, color: "#a78bfa" },
];

export default function AdminSubscriptions() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => { const r = await fetch("/api/admin/stats", { credentials: "include" }); return r.json(); },
  });

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Subscriptions</h1>
          <p className="text-white/40 text-sm mt-0.5">Revenue and plan overview</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="MRR" value="$0" sub="Monthly recurring revenue" icon={<DollarSign className="w-5 h-5" />} color="#00E676" />
          <StatCard label="ARR" value="$0" sub="Annual recurring revenue" icon={<TrendingUp className="w-5 h-5" />} color="#14F195" />
          <StatCard label="Paid Users" value={stats?.paidUsers ?? 0} icon={<Users className="w-5 h-5" />} color="#00D4FF" />
          <StatCard label="Churned" value={stats?.cancelledUsers ?? 0} icon={<XCircle className="w-5 h-5" />} color="#f59e0b" />
        </div>

        <div>
          <h2 className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-4">Plan Breakdown</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {PLANS.map(plan => (
              <div key={plan.name} className="p-6 rounded-2xl border border-white/8 hover:border-white/15 transition-all"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="font-bold text-white text-lg">{plan.name}</div>
                    <div className="text-white/30 text-sm">${plan.price}/mo</div>
                  </div>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: `${plan.color}15`, border: `1px solid ${plan.color}25` }}>
                    <DollarSign className="w-5 h-5" style={{ color: plan.color }} />
                  </div>
                </div>
                <div className="space-y-3">
                  {[["Active Users","0"],["MRR","$0"],["Trial Conversions","—"],["Churn Rate","—"]].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-white/30">{label}</span>
                      <span className="text-sm font-semibold text-white">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
          <div className="text-amber-400 font-semibold text-sm mb-1">Stripe Integration Required</div>
          <div className="text-white/40 text-sm">Connect Stripe to unlock live MRR, churn tracking, and subscription management.</div>
        </div>
      </div>
    </AdminLayout>
  );
}
