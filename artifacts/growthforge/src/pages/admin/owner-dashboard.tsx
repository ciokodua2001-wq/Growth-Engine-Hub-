import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/admin-layout";
import {
  Crown, Users, DollarSign, TrendingDown, TrendingUp, Activity,
  Brain, RefreshCw, AlertCircle, Zap, UserX, UserCheck, FlaskConical,
} from "lucide-react";
import { useIsOwner } from "@/hooks/use-is-owner";

interface OwnerAnalytics {
  totalUsers: number;
  trialUsers: number;
  paidUsers: number;
  cancelledUsers: number;
  newUsersLast7d: number;
  newUsersLast30d: number;
  mrr: number;
  arr: number;
  conversionRate: number;
  churnRate: number;
  churnedThisMonth: number;
  churnedLastMonth: number;
  planBreakdown: Array<{ plan: string; count: number }>;
  aiCost: number;
  aiRequests: number;
  signupTrend: Array<{ day: string; count: number }>;
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

const PLAN_PRICE: Record<string, number> = { starter: 39, "get-going": 99, growth: 299, scale: 799, agency: 799 };

/* ─── Inline SVG bar chart ─────────────────────────────────────────────────── */
function SignupSparkline({ data }: { data: Array<{ day: string; count: number }> }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-24 text-white/20 text-sm">
        No signup data yet
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  const W = 560; const H = 80; const barW = Math.floor(W / data.length) - 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = Math.max(2, (d.count / max) * (H - 4));
        const x = i * (barW + 2);
        const y = H - h;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={h} rx={2}
              fill={d.count > 0 ? "#00E676" : "#ffffff10"} opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── KPI Card ─────────────────────────────────────────────────────────────── */
function KpiCard({
  label, value, sub, icon, color = "#00E676", trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color?: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-2xl p-5 border border-white/8 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">{label}</span>
        <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}18`, color }}>
          {icon}
        </span>
      </div>
      <div>
        <div className="text-2xl font-black text-white">{value}</div>
        {sub && (
          <div className={`text-xs mt-0.5 flex items-center gap-1 ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-white/30"}`}>
            {trend === "up" && <TrendingUp className="w-3 h-3" />}
            {trend === "down" && <TrendingDown className="w-3 h-3" />}
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────────────────── */
export default function OwnerDashboard() {
  const isOwner = useIsOwner();

  const { data, isLoading, error, refetch } = useQuery<OwnerAnalytics>({
    queryKey: ["/api/owner/analytics"],
    queryFn: async () => {
      const r = await fetch("/api/owner/analytics", { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    enabled: isOwner,
    staleTime: 60_000,
  });

  if (!isOwner) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <div className="text-white font-bold text-lg">Access Denied</div>
          <div className="text-white/40 text-sm">Owner's Corner is restricted to the platform owner account.</div>
          <a
            href="/admin/owner/setup"
            className="mt-2 text-xs text-amber-400/60 hover:text-amber-400 transition-colors underline underline-offset-2"
          >
            First time here? Activate Owner's Corner →
          </a>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <div className="text-white font-bold">Failed to load analytics</div>
          <button onClick={() => refetch()} className="text-sm text-white/40 hover:text-white transition-colors flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </AdminLayout>
    );
  }

  const loading = isLoading || !data;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8 max-w-7xl">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)" }}>
                <Crown className="w-4 h-4" style={{ color: "#fbbf24" }} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tight">Owner's Corner</h1>
                <p className="text-white/30 text-xs">Private command center — visible only to you</p>
              </div>
            </div>
            <p className="text-white/40 text-sm mt-2">
              {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white/50 hover:text-white border border-white/10 hover:border-white/20 transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {/* Primary KPIs */}
        <div>
          <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Revenue</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Monthly Revenue" value={loading ? "—" : fmt$(data.mrr)}
              sub="MRR" icon={<DollarSign className="w-4 h-4" />} color="#00E676" />
            <KpiCard label="Annual Revenue" value={loading ? "—" : fmt$(data.arr)}
              sub="ARR" icon={<DollarSign className="w-4 h-4" />} color="#14F195" />
            <KpiCard label="Conversion Rate" value={loading ? "—" : fmtPct(data.conversionRate)}
              sub={loading ? "" : `${data.paidUsers} paid users`}
              icon={<TrendingUp className="w-4 h-4" />} color="#00D4FF"
              trend={!loading && data.conversionRate > 5 ? "up" : "neutral"} />
            <KpiCard label="Churn Rate" value={loading ? "—" : fmtPct(data.churnRate)}
              sub={loading ? "" : `${data.churnedThisMonth} cancelled this month`}
              icon={<TrendingDown className="w-4 h-4" />} color="#f59e0b"
              trend={!loading && data.churnRate > 5 ? "down" : "neutral"} />
          </div>
        </div>

        {/* User KPIs */}
        <div>
          <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Users</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard label="Total Users" value={loading ? "—" : data.totalUsers.toLocaleString()}
              icon={<Users className="w-4 h-4" />} color="#00E676" />
            <KpiCard label="Paid" value={loading ? "—" : data.paidUsers}
              icon={<UserCheck className="w-4 h-4" />} color="#14F195" />
            <KpiCard label="Trial" value={loading ? "—" : data.trialUsers}
              icon={<FlaskConical className="w-4 h-4" />} color="#00D4FF" />
            <KpiCard label="Cancelled" value={loading ? "—" : data.cancelledUsers}
              icon={<UserX className="w-4 h-4" />} color="#f87171" />
            <KpiCard label="New (7d)" value={loading ? "—" : data.newUsersLast7d}
              icon={<Activity className="w-4 h-4" />} color="#a78bfa"
              trend={!loading && data.newUsersLast7d > 0 ? "up" : "neutral"} />
            <KpiCard label="New (30d)" value={loading ? "—" : data.newUsersLast30d}
              icon={<Activity className="w-4 h-4" />} color="#a78bfa"
              trend={!loading && data.newUsersLast30d > 0 ? "up" : "neutral"} />
          </div>
        </div>

        {/* 30-day signup trend */}
        <div>
          <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">30-Day Signup Trend</h2>
          <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.015)" }}>
            {loading ? (
              <div className="flex items-center gap-2 text-white/30 text-sm h-20 justify-center">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading trend…
              </div>
            ) : (
              <>
                <SignupSparkline data={data.signupTrend} />
                <div className="flex justify-between mt-2 text-[10px] text-white/25">
                  <span>30 days ago</span>
                  <span>{data.newUsersLast30d} total signups</span>
                  <span>Today</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Plan breakdown + AI cost */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Plan distribution */}
          <div>
            <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Plan Distribution</h2>
            <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
              <div className="px-5 py-3 border-b border-white/6 grid grid-cols-3 gap-2 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                <span>Plan</span><span>Users</span><span>MRR</span>
              </div>
              <div className="divide-y divide-white/4">
                {loading ? (
                  <div className="px-5 py-4 text-white/30 text-sm">Loading…</div>
                ) : data.planBreakdown.length === 0 ? (
                  <div className="px-5 py-4 text-white/30 text-sm">No paid users yet</div>
                ) : (
                  [...data.planBreakdown]
                    .sort((a, b) => b.count - a.count)
                    .map(({ plan, count: cnt }) => {
                      const mrr = (PLAN_PRICE[plan] ?? 0) * cnt;
                      return (
                        <div key={plan} className="px-5 py-3 grid grid-cols-3 gap-2 text-sm items-center">
                          <span className="font-semibold capitalize text-white/80">{plan}</span>
                          <span className="text-white/60">{cnt}</span>
                          <span className="font-mono text-emerald-400">{fmt$(mrr)}</span>
                        </div>
                      );
                    })
                )}
                {!loading && data.planBreakdown.length > 0 && (
                  <div className="px-5 py-3 grid grid-cols-3 gap-2 text-sm border-t border-white/10">
                    <span className="font-bold text-white/40 text-xs uppercase tracking-wider">Total</span>
                    <span className="text-white/40">{data.paidUsers} paid</span>
                    <span className="font-bold font-mono text-emerald-400">{fmt$(data.mrr)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subscription status breakdown + AI cost */}
          <div className="space-y-4">
            <div>
              <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Subscription Status</h2>
              <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
                {loading ? (
                  <div className="px-5 py-4 text-white/30 text-sm">Loading…</div>
                ) : (
                  <div className="divide-y divide-white/4">
                    {[
                      { label: "Active / Paid", count: data.paidUsers, color: "#00E676" },
                      { label: "Trial", count: data.trialUsers, color: "#00D4FF" },
                      { label: "Cancelled", count: data.cancelledUsers, color: "#f87171" },
                    ].map(({ label, count: cnt, color }) => {
                      const pct = data.totalUsers > 0 ? Math.round((cnt / data.totalUsers) * 100) : 0;
                      return (
                        <div key={label} className="px-5 py-3 flex items-center gap-4">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-sm text-white/70 flex-1">{label}</span>
                          <span className="text-sm font-semibold text-white/60">{cnt}</span>
                          <span className="text-xs text-white/30 w-10 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">AI Usage Cost</h2>
              <div className="rounded-2xl border border-white/8 p-5 flex items-center gap-4" style={{ background: "rgba(255,255,255,0.015)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(167,139,250,0.12)" }}>
                  <Brain className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <div className="text-xl font-black text-white">{loading ? "—" : fmt$(data.aiCost)}</div>
                  <div className="text-xs text-white/30">{loading ? "" : `${data.aiRequests.toLocaleString()} total AI requests`}</div>
                </div>
                {!loading && data.mrr > 0 && (
                  <div className="ml-auto text-right">
                    <div className="text-xs text-white/30">Cost / MRR ratio</div>
                    <div className={`text-sm font-bold ${data.aiCost / data.mrr < 0.3 ? "text-emerald-400" : "text-amber-400"}`}>
                      {fmtPct((data.aiCost / data.mrr) * 100)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Churn comparison */}
            {!loading && (
              <div>
                <h2 className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-3">Churn vs Last Month</h2>
                <div className="rounded-2xl border border-white/8 p-5 flex items-center gap-6" style={{ background: "rgba(255,255,255,0.015)" }}>
                  <div className="text-center">
                    <div className="text-lg font-black text-white">{data.churnedLastMonth}</div>
                    <div className="text-[10px] text-white/30 mt-0.5">Last month</div>
                  </div>
                  <div className="flex-1 h-px bg-white/8" />
                  <div className="text-center">
                    <div className={`text-lg font-black ${data.churnedThisMonth > data.churnedLastMonth ? "text-red-400" : data.churnedThisMonth < data.churnedLastMonth ? "text-emerald-400" : "text-white"}`}>
                      {data.churnedThisMonth}
                    </div>
                    <div className="text-[10px] text-white/30 mt-0.5">This month</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {data.churnedThisMonth > data.churnedLastMonth
                      ? <TrendingDown className="w-4 h-4 text-red-400" />
                      : data.churnedThisMonth < data.churnedLastMonth
                        ? <TrendingUp className="w-4 h-4 text-emerald-400" />
                        : <Zap className="w-4 h-4 text-white/30" />}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Owner's Corner nav — coming up next */}
        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-5">
          <div className="flex items-center gap-3 mb-2">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 font-bold text-sm">More Owner's Corner tools coming</span>
          </div>
          <p className="text-white/40 text-sm">
            Email Marketing Hub, Contact Management, User Segmentation, and Broadcast Messaging are being built next.
            They'll appear in the Owner's Corner nav when ready.
          </p>
        </div>

      </div>
    </AdminLayout>
  );
}
