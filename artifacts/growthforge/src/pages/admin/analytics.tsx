import { TrendingUp, Users, UserCheck, Activity, Percent } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";
import StatCard from "@/components/admin/stat-card";
import { useQuery } from "@tanstack/react-query";

interface Stats { totalUsers: number; trialUsers: number; paidUsers: number; }

export default function AdminAnalytics() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => { const r = await fetch("/api/admin/stats", { credentials: "include" }); return r.json(); },
  });

  const conversionRate = stats && stats.trialUsers > 0
    ? Math.round((stats.paidUsers / (stats.paidUsers + stats.trialUsers)) * 100)
    : 0;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Platform Analytics</h1>
          <p className="text-white/40 text-sm mt-0.5">Growth and engagement metrics</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Users" value={stats?.totalUsers ?? 0} icon={<Users className="w-5 h-5" />} color="#00E676" />
          <StatCard label="Trial Users" value={stats?.trialUsers ?? 0} icon={<Activity className="w-5 h-5" />} color="#00D4FF" />
          <StatCard label="Paid Users" value={stats?.paidUsers ?? 0} icon={<UserCheck className="w-5 h-5" />} color="#14F195" />
          <StatCard label="Trial Conversion" value={`${conversionRate}%`} icon={<Percent className="w-5 h-5" />} color="#a78bfa" />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {[
            { label: "Daily Active Users", note: "Analytics tracking not yet enabled" },
            { label: "Feature Usage", note: "Requires event tracking integration" },
            { label: "Retention Rate", note: "Requires cohort analysis setup" },
            { label: "Top Acquisition Channels", note: "Requires UTM / attribution setup" },
          ].map(({ label, note }) => (
            <div key={label} className="p-6 rounded-2xl border border-white/8" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="font-semibold text-white mb-1">{label}</div>
              <div className="flex items-center justify-center h-32">
                <div className="text-center">
                  <TrendingUp className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <div className="text-white/20 text-xs">{note}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
