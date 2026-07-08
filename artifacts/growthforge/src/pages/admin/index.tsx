import { useQuery } from "@tanstack/react-query";
import { Users, FolderOpen, TrendingUp, Activity, DollarSign, Brain, AlertCircle, CheckCircle } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";
import StatCard from "@/components/admin/stat-card";

interface Stats {
  totalUsers: number; trialUsers: number; paidUsers: number; cancelledUsers: number;
  activeUsers: number; totalProjects: number; monthlyRevenue: number;
  annualRevenue: number; totalAiRequests: number; estimatedAiCost: number;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function AdminDashboard() {
  const { data: stats, isLoading, error } = useQuery<Stats>({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => {
      const r = await fetch("/api/admin/stats", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  if (error) {
    const is403 = error.message?.includes("403") || error.message?.includes("Forbidden");
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <div className="text-white font-bold text-xl mb-2">Access Denied</div>
            <div className="text-white/40 text-sm max-w-sm">
              {is403
                ? "Your account doesn't have admin permissions. Use the button below to claim Super Admin access if you're the first admin."
                : "Could not load admin data. Make sure you're signed in."}
            </div>
          </div>
          {is403 && (
            <button
              onClick={async () => {
                try {
                  const r = await fetch("/api/admin/self/promote", { method: "POST", credentials: "include" });
                  const data = await r.json();
                  if (r.ok) { window.location.reload(); }
                  else { alert(data.error ?? "Could not promote. An admin already exists."); }
                } catch { alert("Request failed. Try again."); }
              }}
              className="px-6 py-3 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02]"
              style={{ background: "#00E676" }}>
              Claim Super Admin Access
            </button>
          )}
          <p className="text-white/20 text-xs max-w-xs">
            This button only works if no admins exist yet. Once claimed, use User Management to grant access to others.
          </p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Admin Dashboard</h1>
          <p className="text-white/40 text-sm mt-1">Platform overview — {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        </div>

        {/* Platform Health */}
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <span className="text-emerald-400 font-semibold text-sm">All systems operational</span>
            <span className="text-white/30 text-sm ml-2">· API healthy · DB connected · Auth active</span>
          </div>
        </div>

        {/* KPI cards */}
        <div>
          <h2 className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-4">Users</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Users" value={isLoading ? "—" : stats!.totalUsers}
              icon={<Users className="w-5 h-5" />} color="#00E676" />
            <StatCard label="Trial Users" value={isLoading ? "—" : stats!.trialUsers}
              sub="Active free trials" icon={<Activity className="w-5 h-5" />} color="#00D4FF" />
            <StatCard label="Paid Users" value={isLoading ? "—" : stats!.paidUsers}
              sub="Active subscriptions" icon={<TrendingUp className="w-5 h-5" />} color="#14F195" />
            <StatCard label="Churned" value={isLoading ? "—" : stats!.cancelledUsers}
              sub="Cancelled accounts" icon={<AlertCircle className="w-5 h-5" />} color="#f59e0b" />
          </div>
        </div>

        <div>
          <h2 className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-4">Revenue & Usage</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Monthly Revenue" value={isLoading ? "—" : fmtCurrency(stats!.monthlyRevenue)}
              sub="MRR" icon={<DollarSign className="w-5 h-5" />} color="#00E676" />
            <StatCard label="Annual Revenue" value={isLoading ? "—" : fmtCurrency(stats!.annualRevenue)}
              sub="ARR" icon={<DollarSign className="w-5 h-5" />} color="#14F195" />
            <StatCard label="Total Projects" value={isLoading ? "—" : stats!.totalProjects}
              icon={<FolderOpen className="w-5 h-5" />} color="#00D4FF" />
            <StatCard label="AI Requests" value={isLoading ? "—" : stats!.totalAiRequests}
              sub={isLoading ? "" : `Est. cost ${fmtCurrency(stats!.estimatedAiCost)}`}
              icon={<Brain className="w-5 h-5" />} color="#a78bfa" />
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "View All Users", href: "/admin/users", color: "#00E676" },
              { label: "Manage Features", href: "/admin/features", color: "#00D4FF" },
              { label: "Announcements", href: "/admin/announcements", color: "#14F195" },
              { label: "Audit Log", href: "/admin/audit", color: "#a78bfa" },
            ].map(({ label, href, color }) => (
              <a key={href} href={href}
                className="p-4 rounded-xl border border-white/8 hover:border-white/20 transition-all text-sm font-semibold text-center"
                style={{ background: "rgba(255,255,255,0.02)", color }}>
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
