import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, ExternalLink, CheckCircle, XCircle, AlertTriangle,
  Minus, ArrowUpCircle, ArrowDownCircle, ChevronDown, ChevronUp,
  Plus, Settings, BarChart2, Video, Clock, DollarSign, Zap, CreditCard,
  Film, TrendingUp, Users, ShoppingCart, Gift, Search, User,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

/* ─── Video analytics types ──────────────────────────────────── */
interface VideoAnalyticsData {
  walletStats: {
    totalUsers: number;
    totalMonthlyAlloc: number;
    totalMonthlyUsed: number;
    totalPurchasedRemaining: number;
    totalPurchasedEver: number;
    totalRenderedEver: number;
  };
  planBreakdown: Array<{
    plan: string;
    userCount: number;
    totalMonthlyAlloc: number;
    totalMonthlyUsed: number;
    totalPurchased: number;
  }>;
  last30Days: {
    purchases: { totalSeconds: number; totalUsdPaid: number; purchaseCount: number };
    renders: { totalSeconds: number; renderCount: number };
  };
  economics: {
    klingCostPerSecond: number;
    retailPerSecond: number;
    platformCost: number;
    totalRevenueEver: number;
    estimatedMarginPct: number | null;
  };
}

function fmtSec(s: number | null | undefined): string {
  const n = Number(s ?? 0);
  if (n >= 3600) return `${(n / 3600).toFixed(1)}h`;
  if (n >= 60)   return `${(n / 60).toFixed(1)}m`;
  return `${n}s`;
}

function fmtUsdSimple(v: number | null | undefined, digits = 2): string {
  return `$${Number(v ?? 0).toFixed(digits)}`;
}

/* ─── Gift credits panel ─────────────────────────────────────── */
interface WalletRow {
  userId: string;
  plan: string;
  monthlyVideoSeconds: number;
  monthlySecondsUsed: number;
  purchasedVideoSeconds: number;
  email: string | null;
}

const QUICK_SECONDS = [15, 30, 60, 120, 300] as const;

function GiftCreditsPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WalletRow | null>(null);
  const [seconds, setSeconds] = useState(30);
  const [customSec, setCustomSec] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(v), 300);
  };

  const { data: wallets = [], isFetching } = useQuery<WalletRow[]>({
    queryKey: ["admin-video-wallets", debouncedSearch],
    queryFn: async () => {
      const qs = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : "?limit=30";
      const r = await fetch(`/api/admin/video-wallets${qs}`);
      if (!r.ok) throw new Error("Failed to load wallets");
      return r.json() as Promise<WalletRow[]>;
    },
    enabled: open,
  });

  const gift = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No user selected");
      const finalSeconds = customSec ? parseInt(customSec, 10) : seconds;
      const r = await fetch("/api/admin/video-wallets/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.userId, seconds: finalSeconds, note: note || undefined }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(err.error ?? "Gift failed");
      }
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-video-wallets"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-video-analytics"] });
      setDone(true);
      setNote("");
      setSelected(null);
      setTimeout(() => setDone(false), 3000);
    },
  });

  const effectiveSeconds = customSec ? parseInt(customSec, 10) || 0 : seconds;

  return (
    <div className="rounded-2xl border border-[#14F195]/15 overflow-hidden"
      style={{ background: "rgba(20,241,149,0.02)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-white/2 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(20,241,149,0.12)", border: "1px solid rgba(20,241,149,0.2)" }}>
            <Gift className="w-4 h-4 text-[#14F195]" />
          </div>
          <div className="text-left">
            <div className="text-sm font-bold text-white">Gift Video Credits</div>
            <div className="text-xs text-white/40">Add seconds to any user's video wallet</div>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/6">
          {/* Search */}
          <div className="pt-4">
            <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block mb-2">
              Find User
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
              <input
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="Search by email…"
                className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
                style={{ background: "rgba(255,255,255,0.04)" }}
              />
              {isFetching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20 animate-spin" />}
            </div>
          </div>

          {/* User list */}
          {wallets.length > 0 && (
            <div className="rounded-xl overflow-hidden border border-white/6 max-h-52 overflow-y-auto"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              {wallets.map(w => {
                const isSelected = selected?.userId === w.userId;
                const purchased = Number(w.purchasedVideoSeconds);
                const monthlyRemaining = Math.max(0, Number(w.monthlyVideoSeconds) - Number(w.monthlySecondsUsed));
                return (
                  <button
                    key={w.userId}
                    onClick={() => setSelected(isSelected ? null : w)}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-white/4 last:border-0 text-left transition-colors ${isSelected ? "bg-[#14F195]/8" : "hover:bg-white/3"}`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? "bg-[#14F195]/20" : "bg-white/6"}`}>
                      <User className={`w-3.5 h-3.5 ${isSelected ? "text-[#14F195]" : "text-white/30"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{w.email ?? w.userId}</p>
                      <p className="text-[10px] text-white/30 capitalize">{w.plan} · {monthlyRemaining}s monthly + {purchased}s purchased</p>
                    </div>
                    {isSelected && <CheckCircle className="w-4 h-4 text-[#14F195] shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {wallets.length === 0 && !isFetching && debouncedSearch && (
            <p className="text-xs text-white/30 text-center py-2">No wallets found for "{debouncedSearch}"</p>
          )}

          {/* Amount */}
          {selected && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block mb-2">
                  Seconds to Gift
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {QUICK_SECONDS.map(s => (
                    <button
                      key={s}
                      onClick={() => { setSeconds(s); setCustomSec(""); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${!customSec && seconds === s ? "border-[#14F195]/40 text-[#14F195] bg-[#14F195]/8" : "border-white/8 text-white/40 hover:text-white/60"}`}>
                      {s}s
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    placeholder="Custom…"
                    value={customSec}
                    onChange={e => setCustomSec(e.target.value)}
                    className="w-24 px-3 py-1.5 rounded-lg border border-white/8 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors text-center"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  />
                </div>
                <p className="text-xs text-white/30">
                  Gifting <span className="text-[#14F195] font-bold">{effectiveSeconds}s</span> (~{Math.round(effectiveSeconds / 15)} video{effectiveSeconds !== 15 ? "s" : ""}) to{" "}
                  <span className="text-white">{selected.email ?? selected.userId}</span>
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-white/30 uppercase tracking-widest block mb-2">
                  Note (optional)
                </label>
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Compensation for failed render"
                  className="w-full px-3 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => gift.mutate()}
                  disabled={gift.isPending || effectiveSeconds <= 0}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: done ? "#00E676" : "#14F195" }}>
                  {done ? <CheckCircle className="w-4 h-4" /> : <Gift className="w-4 h-4" />}
                  {done ? "Gifted!" : gift.isPending ? "Gifting…" : `Gift ${effectiveSeconds}s`}
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="px-4 py-2.5 rounded-xl border border-white/8 text-xs text-white/40 hover:text-white/60 transition-colors">
                  Cancel
                </button>
                {gift.isError && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {(gift.error as Error).message}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Video analytics section ────────────────────────────────── */
function VideoAnalyticsSection() {
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery<VideoAnalyticsData>({
    queryKey: ["admin-video-analytics"],
    queryFn: async () => {
      const r = await fetch("/api/admin/video-analytics");
      if (!r.ok) throw new Error("Failed to load video analytics");
      return r.json() as Promise<VideoAnalyticsData>;
    },
    enabled: open,
  });

  const ws = data?.walletStats;
  const eco = data?.economics;
  const l30 = data?.last30Days;

  return (
    <div className="rounded-2xl border border-[#00D4FF]/15 overflow-hidden"
      style={{ background: "rgba(0,212,255,0.03)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-white/2 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.2)" }}>
            <Film className="w-4 h-4 text-[#00D4FF]" />
          </div>
          <div className="text-left">
            <div className="text-sm font-bold text-white">Video Credit Economy</div>
            <div className="text-xs text-white/40">Platform-wide wallet stats and revenue</div>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-white/6">
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2 text-white/30">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading analytics…
            </div>
          )}
          {error && <p className="text-red-400 text-sm py-4 text-center">Could not load video analytics.</p>}

          {data && (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                {[
                  { icon: <Users className="w-3.5 h-3.5" />, label: "Wallets", value: String(Number(ws?.totalUsers ?? 0)), color: "#00D4FF" },
                  { icon: <Film className="w-3.5 h-3.5" />, label: "Rendered (all time)", value: fmtSec(ws?.totalRenderedEver), color: "#00E676" },
                  { icon: <ShoppingCart className="w-3.5 h-3.5" />, label: "Purchased (30d)", value: fmtSec(l30?.purchases.totalSeconds), color: "#14F195" },
                  { icon: <TrendingUp className="w-3.5 h-3.5" />, label: "Revenue (30d)", value: fmtUsdSimple(l30?.purchases.totalUsdPaid), color: "#00E676" },
                ].map(({ icon, label, value, color }) => (
                  <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5" style={{ color }}>
                      {icon}
                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</span>
                    </div>
                    <div className="text-white font-black text-xl">{value}</div>
                  </div>
                ))}
              </div>

              {/* Economics */}
              <div className="rounded-xl p-4 space-y-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Economics</p>
                {[
                  ["Kling cost / second", fmtUsdSimple(eco?.klingCostPerSecond, 4)],
                  ["Retail price / second", fmtUsdSimple(eco?.retailPerSecond, 2)],
                  ["Total Kling cost (all time)", fmtUsdSimple(eco?.platformCost, 2)],
                  ["Total credit revenue (all time)", fmtUsdSimple(eco?.totalRevenueEver, 2)],
                  ["Estimated margin", eco?.estimatedMarginPct != null ? `${eco.estimatedMarginPct}%` : "—"],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-white/40">{label}</span>
                    <span className="text-white font-semibold font-mono">{val}</span>
                  </div>
                ))}
              </div>

              {/* Plan breakdown */}
              {(data.planBreakdown?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Usage by Plan</p>
                  {data.planBreakdown.map(pb => {
                    const pct = Number(pb.totalMonthlyAlloc) > 0
                      ? Math.round((Number(pb.totalMonthlyUsed) / Number(pb.totalMonthlyAlloc)) * 100)
                      : 0;
                    return (
                      <div key={pb.plan} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-white capitalize">{pb.plan}</span>
                          <span className="text-xs text-white/40">{Number(pb.userCount)} users</span>
                        </div>
                        <div className="h-1 rounded-full bg-white/8 overflow-hidden mb-1">
                          <div className="h-full rounded-full bg-[#00E676]" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <div className="flex gap-4 text-[10px] text-white/30">
                          <span>Used {fmtSec(pb.totalMonthlyUsed)} / {fmtSec(pb.totalMonthlyAlloc)}</span>
                          <span>{pct}%</span>
                          <span>Purchased: {fmtSec(pb.totalPurchased)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Types ──────────────────────────────────────────────────── */

interface SpendProvider {
  type: "spend";
  displayName: string; icon: string; managedBy: string;
  dashboardUrl: string; totalSpend: number; monthlySpend: number; unit: string;
}
interface LiveProvider {
  type: "live";
  displayName: string; icon: string; dashboardUrl: string;
  keyConfigured: boolean; keyValid: boolean | null;
  balance: number | null; used: number | null; limit: number | null;
  pct: number | null; unit: string; note: string | null;
}
interface BankProvider {
  type: "bank";
  displayName: string; icon: string; dashboardUrl: string;
  keyConfigured: boolean; keyValid: boolean | null;
  balance: number | null; peakBalance: number | null; totalAdded: number | null;
  pct: number | null; unit: string;
  alertThresholdPct: number; alertEmail: string | null; alertEnabled: boolean;
  note: string | null;
  totalCreditsConsumed?: number | null;
  totalUsdSpent?: number | null;
  totalVideosGenerated?: number | null;
  totalMinutesGenerated?: number | null;
  costPerCredit?: number | null;
  billingModel?: "payg" | "subscription" | string;
  subscriptionPlan?: string | null;
  subscriptionCostUsd?: number | null;
  monthlyCredits?: number | null;
}
interface UnifiedData {
  anthropic:  SpendProvider;
  openai:     LiveProvider;
  elevenlabs: LiveProvider;
  kling:      BankProvider;
  shotstack:  BankProvider;
}
interface Transaction {
  id: number; provider: string; type: string; amount: number;
  balanceAfter: number; description: string; createdAt: string;
  purchaseCostUsd?: number | null;
  minutesGenerated?: number | null;
  videosCount?: number | null;
}
interface BankReport {
  provider: string;
  billingModel: string;
  creditsPurchased: number; creditsConsumed: number; creditsRemaining: number | null;
  usdSpent: number; estimatedUsdConsumed: number; estimatedUsdRemaining: number | null;
  videosGenerated: number; minutesGenerated: number;
  avgCreditsPerMinute: number | null;
  avgCostPerMinute: number | null;
  avgCostPerVideo: number | null;
  topupCount: number; deductionCount: number; costPerCredit: number;
}

/* ─── Helpers ────────────────────────────────────────────────── */

const COLORS: Record<string, string> = {
  anthropic: "#a78bfa", openai: "#00D4FF", elevenlabs: "#f59e0b",
  kling: "#00E676", shotstack: "#14F195",
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
function fmtCredits(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtN(n: number, unit: string) {
  if (unit === "USD") return fmtUsd(n);
  return fmtCredits(n) + " " + unit;
}

function BillingBadge({ model }: { model: string }) {
  const isSubscription = model === "subscription";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{
        background: isSubscription ? "rgba(0,212,255,0.12)" : "rgba(20,241,149,0.1)",
        color: isSubscription ? "#00D4FF" : "#14F195",
        border: `1px solid ${isSubscription ? "rgba(0,212,255,0.2)" : "rgba(20,241,149,0.15)"}`,
      }}>
      <CreditCard className="w-2.5 h-2.5" />
      {isSubscription ? "Subscription" : "Pay-As-You-Go"}
    </span>
  );
}

function Bar({ pct, threshold = 30 }: { pct: number; threshold?: number }) {
  const c = pct <= threshold ? "#ef4444" : pct <= threshold * 1.5 ? "#f59e0b" : "#00E676";
  return (
    <div className="w-full h-1.5 rounded-full mt-2" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: c }} />
    </div>
  );
}

function KeyBadge({ configured, valid }: { configured: boolean; valid: boolean | null }) {
  if (!configured) return <span className="text-white/30 text-xs flex items-center gap-1"><Minus className="w-3 h-3" /> Key not set</span>;
  if (valid === null) return <span className="text-white/40 text-xs">Checking…</span>;
  return valid
    ? <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Key valid</span>
    : <span className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Key invalid</span>;
}

function StatBox({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon?: React.FC<{ className?: string; style?: React.CSSProperties }>;
  color?: string;
}) {
  return (
    <div className="rounded-xl p-3 flex flex-col gap-0.5" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className="flex items-center gap-1.5 text-white/35 text-[10px] uppercase tracking-wider mb-0.5">
        {Icon && <Icon className="w-3 h-3" style={{ color }} />}
        {label}
      </div>
      <div className="text-white font-bold text-sm leading-tight" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-white/30 text-[10px] leading-tight">{sub}</div>}
    </div>
  );
}

/* ─── Transaction list ───────────────────────────────────────── */

function TxnList({ provider }: { provider: string }) {
  const isBank = provider === "kling" || provider === "shotstack";
  const { data, isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/admin/credits/transactions", provider],
    queryFn: async () => {
      const r = await fetch(`/api/admin/credits/transactions/${provider}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });
  if (isLoading) return <p className="text-white/25 text-xs text-center py-3">Loading…</p>;
  if (!data || data.length === 0) return <p className="text-white/25 text-xs text-center py-3">No transactions yet</p>;
  return (
    <div className="space-y-1 max-h-52 overflow-y-auto">
      {data.map((t) => (
        <div key={t.id} className="flex items-start gap-3 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
          {t.type === "topup"
            ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="text-white/60 text-xs truncate">{t.description}</div>
            <div className="text-white/25 text-[10px] flex gap-2 flex-wrap mt-0.5">
              <span>{new Date(t.createdAt).toLocaleString()}</span>
              {isBank && t.type === "topup" && t.purchaseCostUsd != null && (
                <span className="text-emerald-300/50">{fmtUsd(t.purchaseCostUsd)} paid</span>
              )}
              {isBank && t.type === "deduction" && t.minutesGenerated != null && (
                <span>{(t.minutesGenerated * 60).toFixed(0)}s rendered</span>
              )}
            </div>
          </div>
          <div className={`text-xs font-bold shrink-0 ${t.type === "topup" ? "text-emerald-400" : "text-red-400"}`}>
            {t.type === "topup" ? "+" : "-"}{fmtCredits(t.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Credit bank top-up modal (Kling + Shotstack) ──────────── */

function BankTopUpModal({ provider, displayName, onClose, onDone }: {
  provider: string; displayName: string; onClose: () => void; onDone: () => void;
}) {
  const [credits, setCredits] = useState("");
  const [costUsd, setCostUsd] = useState("");
  const [notes, setNotes]     = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");

  const c    = parseFloat(credits);
  const cost = parseFloat(costUsd);
  const showPreview = !isNaN(c) && !isNaN(cost) && c > 0 && cost > 0;

  async function submit() {
    if (!c || c <= 0) { setErr("Enter a positive number of credits"); return; }
    setLoading(true); setErr("");
    try {
      const body: Record<string, unknown> = { credits: c, notes };
      if (!isNaN(cost) && cost > 0) body.purchaseCostUsd = cost;
      const r = await fetch(`/api/admin/credits/bank/${provider}/topup`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      onDone();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6 space-y-4" style={{ background: "#0d1b2e" }}>
        <div>
          <div className="text-white font-bold text-lg">Top Up {displayName}</div>
          <div className="text-white/35 text-xs mt-1">Credits are the primary balance unit · USD tracked separately for accounting</div>
        </div>

        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1.5">Credits Added <span className="text-red-400">*</span></label>
          <input type="number" min="0" step="1" value={credits} onChange={(e) => setCredits(e.target.value)}
            placeholder={provider === "kling" ? "e.g. 100" : "e.g. 1000"}
            className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-[#00E676]/50 transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }} />
          <p className="text-white/25 text-[11px] mt-1">
            {provider === "kling"
              ? "Enter number of clips purchased (or use 1 credit = $0.10 as a proxy unit)"
              : "Enter exact credits shown on Shotstack receipt"}
          </p>
        </div>

        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1.5">Purchase Cost (USD) <span className="text-white/25">optional</span></label>
          <input type="number" min="0" step="0.01" value={costUsd} onChange={(e) => setCostUsd(e.target.value)}
            placeholder="e.g. 25.00"
            className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-[#00E676]/50 transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }} />
          <p className="text-white/25 text-[11px] mt-1">Stored for financial reporting — not used for balance tracking</p>
        </div>

        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1.5">Notes (optional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={`e.g. ${displayName} invoice #1234`}
            className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-[#00E676]/50 transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>

        {showPreview && (
          <div className="px-3 py-2.5 rounded-xl text-xs text-white/50 space-y-1"
            style={{ background: "rgba(0,230,118,0.06)", border: "1px solid rgba(0,230,118,0.12)" }}>
            <p>
              <span className="text-[#00E676] font-bold">{c.toLocaleString()}</span> credits @{" "}
              <span className="text-[#00E676] font-bold">{fmtUsd(cost / c)}</span> per credit
            </p>
          </div>
        )}

        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white/50 border border-white/10 hover:text-white hover:border-white/30 transition-all">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: "#00E676" }}>
            {loading ? "Adding…" : "Add Credits"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Credit bank date-range report ─────────────────────────── */

function CreditBankReport({ provider }: { provider: string }) {
  const today         = new Date().toISOString().slice(0, 10);
  const firstOfMonth  = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate]     = useState(today);
  const [trigger, setTrigger]     = useState(0);

  const { data, isLoading, error } = useQuery<BankReport>({
    queryKey: ["/api/admin/credits/reports", provider, startDate, endDate, trigger],
    queryFn: async () => {
      const p = new URLSearchParams({ startDate, endDate });
      const r = await fetch(`/api/admin/credits/reports/${provider}?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: trigger > 0,
    staleTime: 30_000,
  });

  const presets = [
    { label: "This Month", start: firstOfMonth, end: today },
    {
      label: "Last Month",
      start: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10),
      end:   new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10),
    },
    { label: "This Year", start: `${new Date().getFullYear()}-01-01`, end: today },
    { label: "Last 90 Days", start: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), end: today },
  ];

  return (
    <div className="space-y-4 pt-3 border-t border-white/8">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p.label}
            onClick={() => { setStartDate(p.start); setEndDate(p.end); }}
            className="px-2.5 py-1 rounded-lg text-[11px] border border-white/10 text-white/40 hover:text-white hover:border-white/25 transition-all">
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-white/35 text-[10px] uppercase tracking-wider block mb-1">Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
        <div className="flex-1">
          <label className="text-white/35 text-[10px] uppercase tracking-wider block mb-1">End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
        <button onClick={() => setTrigger((t) => t + 1)} disabled={isLoading}
          className="px-4 py-2 rounded-lg text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: "#00E676" }}>
          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Run"}
        </button>
      </div>

      {trigger === 0 && (
        <p className="text-white/20 text-xs text-center py-2">Select a date range and click Run to generate a report.</p>
      )}
      {error && <p className="text-red-400 text-xs">Failed to load report.</p>}

      {data && trigger > 0 && (
        <div className="space-y-3">
          <p className="text-white/30 text-[10px] uppercase tracking-widest">Credit Activity</p>
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="Purchased" value={fmtCredits(data.creditsPurchased)} icon={ArrowUpCircle} color="#00E676" />
            <StatBox label="Consumed"  value={fmtCredits(data.creditsConsumed)}  icon={ArrowDownCircle} color="#ef4444" />
            <StatBox label="Remaining" value={data.creditsRemaining != null ? fmtCredits(data.creditsRemaining) : "—"} icon={Zap} color="#00D4FF" />
          </div>

          <p className="text-white/30 text-[10px] uppercase tracking-widest">Financial Activity</p>
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="USD Spent" value={fmtUsd(data.usdSpent)}
              sub={`${data.topupCount} purchase${data.topupCount !== 1 ? "s" : ""}`}
              icon={DollarSign} color="#f59e0b" />
            <StatBox label="Est. Consumed" value={fmtUsd(data.estimatedUsdConsumed)} icon={DollarSign} color="#ef4444" />
            <StatBox label="Est. Remaining" value={data.estimatedUsdRemaining != null ? fmtUsd(data.estimatedUsdRemaining) : "—"} icon={DollarSign} color="#00E676" />
          </div>

          <p className="text-white/30 text-[10px] uppercase tracking-widest">Production Activity</p>
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Videos" value={data.videosGenerated.toLocaleString()}
              sub={`${data.deductionCount} render events`} icon={Video} color="#00E676" />
            <StatBox label="Minutes" value={data.minutesGenerated.toFixed(1)}
              sub="rendered" icon={Clock} color="#00E676" />
            {data.avgCreditsPerMinute != null && (
              <StatBox label="Avg Credits / Min" value={data.avgCreditsPerMinute.toFixed(2)} />
            )}
            {data.avgCostPerMinute != null && (
              <StatBox label="Avg Cost / Min" value={fmtUsd(data.avgCostPerMinute)}
                sub={`@ ${fmtUsd(data.costPerCredit)}/credit`} />
            )}
            {data.avgCostPerVideo != null && (
              <StatBox label="Avg Cost / Video" value={fmtUsd(data.avgCostPerVideo)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Settings panel (alerts + billing model) ────────────────── */

function SettingsPanel({ provider, p, onSaved }: { provider: string; p: BankProvider; onSaved: () => void }) {
  const [threshold, setThreshold]   = useState(String(p.alertThresholdPct));
  const [email, setEmail]           = useState(p.alertEmail ?? "");
  const [enabled, setEnabled]       = useState(p.alertEnabled);
  const [billing, setBilling]       = useState<"payg" | "subscription">(
    (p.billingModel as "payg" | "subscription") ?? "payg",
  );
  const [subPlan, setSubPlan]       = useState(p.subscriptionPlan ?? "");
  const [subCost, setSubCost]       = useState(p.subscriptionCostUsd != null ? String(p.subscriptionCostUsd) : "");
  const [subCredits, setSubCredits] = useState(p.monthlyCredits != null ? String(p.monthlyCredits) : "");
  const [loading, setLoading]       = useState(false);
  const [saved, setSaved]           = useState(false);

  async function save() {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        alertThresholdPct: parseInt(threshold, 10),
        alertEmail: email,
        alertEnabled: enabled,
        billingModel: billing,
        subscriptionPlan: subPlan.trim() || null,
        subscriptionCostUsd: billing === "subscription" && subCost ? parseFloat(subCost) : null,
        monthlyCredits: billing === "subscription" && subCredits ? parseFloat(subCredits) : null,
      };
      const r = await fetch(`/api/admin/credits/bank/${provider}/settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(true);
      setTimeout(() => { setSaved(false); onSaved(); }, 1200);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4 pt-3 border-t border-white/8">
      <div>
        <p className="text-white/35 text-[10px] uppercase tracking-widest mb-2">Billing Model</p>
        <div className="flex gap-2">
          {(["payg", "subscription"] as const).map((m) => (
            <button key={m} onClick={() => setBilling(m)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold border transition-all"
              style={{
                background: billing === m ? (m === "subscription" ? "rgba(0,212,255,0.12)" : "rgba(0,230,118,0.12)") : "rgba(255,255,255,0.04)",
                borderColor: billing === m ? (m === "subscription" ? "rgba(0,212,255,0.3)" : "rgba(0,230,118,0.3)") : "rgba(255,255,255,0.1)",
                color: billing === m ? (m === "subscription" ? "#00D4FF" : "#00E676") : "rgba(255,255,255,0.4)",
              }}>
              {m === "payg" ? "Pay-As-You-Go" : "Subscription"}
            </button>
          ))}
        </div>
      </div>

      {billing === "subscription" && (
        <div className="space-y-3 p-3 rounded-xl" style={{ background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.1)" }}>
          <p className="text-[#00D4FF]/60 text-[10px] uppercase tracking-wider">Subscription Details</p>
          <div>
            <label className="text-white/40 text-xs block mb-1">Plan Name</label>
            <input type="text" value={subPlan} onChange={(e) => setSubPlan(e.target.value)}
              placeholder="e.g. Monthly Pro"
              className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
              style={{ background: "rgba(255,255,255,0.06)" }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-white/40 text-xs block mb-1">Monthly Cost (USD)</label>
              <input type="number" min="0" step="0.01" value={subCost} onChange={(e) => setSubCost(e.target.value)}
                placeholder="e.g. 99.00"
                className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
                style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>
            <div>
              <label className="text-white/40 text-xs block mb-1">Included Credits / Month</label>
              <input type="number" min="0" step="1" value={subCredits} onChange={(e) => setSubCredits(e.target.value)}
                placeholder="e.g. 1000"
                className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
                style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="text-white/35 text-[10px] uppercase tracking-widest mb-2">Low Balance Alerts</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-white/40 text-xs block mb-1">Alert at %</label>
            <input type="number" min="1" max="99" value={threshold} onChange={(e) => setThreshold(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
              style={{ background: "rgba(255,255,255,0.06)" }} />
          </div>
          <div>
            <label className="text-white/40 text-xs block mb-1">Alert email</label>
            <input type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
              style={{ background: "rgba(255,255,255,0.06)" }} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-white/60 text-sm">Email alerts</span>
          <button onClick={() => setEnabled(!enabled)}
            className="relative w-10 h-5 rounded-full transition-all" style={{ background: enabled ? "#00E676" : "rgba(255,255,255,0.1)" }}>
            <div className={`absolute top-0.5 w-4 h-4 bg-black rounded-full transition-all ${enabled ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
      </div>

      <button onClick={save} disabled={loading}
        className="px-4 py-2 rounded-lg text-xs font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{ background: saved ? "#14F195" : "#00E676" }}>
        {saved ? "✓ Saved" : loading ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

/* ─── Card: Anthropic (spend tracker) ───────────────────────── */

function SpendCard({ p, provider }: { p: SpendProvider; provider: string }) {
  const [show, setShow] = useState(false);
  const color = COLORS[provider] ?? "#a78bfa";
  return (
    <div className="rounded-2xl border border-white/8 p-5 space-y-4" style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: `${color}15`, border: `1px solid ${color}25` }}>{p.icon}</div>
          <div>
            <div className="text-white font-bold text-sm">{p.displayName}</div>
            <div className="text-xs mt-0.5" style={{ color }}>{p.managedBy}</div>
          </div>
        </div>
        <a href={p.dashboardUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white border border-white/8 hover:border-white/20 transition-all shrink-0">
          <ExternalLink className="w-3 h-3" /> Dashboard
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="text-white/40 text-xs mb-1">This month</div>
          <div className="text-white font-black text-lg">{fmtN(p.monthlySpend, p.unit)}</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="text-white/40 text-xs mb-1">All time</div>
          <div className="text-white font-black text-lg">{fmtN(p.totalSpend, p.unit)}</div>
        </div>
      </div>
      <p className="text-white/25 text-xs">Estimated spend based on token counts × Claude Sonnet pricing. Billed to Replit — manage at replit.com.</p>
      <button onClick={() => setShow(!show)}
        className="text-xs text-white/30 hover:text-white/60 transition-all flex items-center gap-1">
        {show ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Call history
      </button>
      {show && <TxnList provider={provider} />}
    </div>
  );
}

/* ─── Card: ElevenLabs / OpenAI (live API) ───────────────────── */

function LiveCard({ p, provider }: { p: LiveProvider; provider: string }) {
  const [show, setShow] = useState(false);
  const color = COLORS[provider] ?? "#00D4FF";
  const isLow = p.pct !== null && p.pct <= 30;
  const isWarn = p.pct !== null && !isLow && p.pct <= 45;
  return (
    <div className="rounded-2xl border p-5 space-y-4"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: isLow ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: `${color}15`, border: `1px solid ${color}25` }}>{p.icon}</div>
          <div>
            <div className="text-white font-bold text-sm">{p.displayName}</div>
            <div className="mt-0.5"><KeyBadge configured={p.keyConfigured} valid={p.keyValid} /></div>
          </div>
        </div>
        <a href={p.dashboardUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white border border-white/8 hover:border-white/20 transition-all shrink-0">
          <ExternalLink className="w-3 h-3" /> Dashboard
        </a>
      </div>

      {!p.keyConfigured ? (
        <div className="px-3 py-2.5 rounded-xl text-xs text-white/40" style={{ background: "rgba(255,255,255,0.04)" }}>
          Add <code className="font-mono text-white/60 mx-0.5">{provider.toUpperCase()}_API_KEY</code> to Replit Secrets to enable.
        </div>
      ) : p.keyValid === false ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-red-400" style={{ background: "rgba(239,68,68,0.06)" }}>
          <XCircle className="w-3 h-3 shrink-0" /> API key is invalid or revoked — update it in Replit Secrets.
        </div>
      ) : p.pct !== null && p.balance !== null ? (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-white text-2xl font-black">{fmtN(p.balance, p.unit)}</span>
            <span className="text-white/40 text-xs">{p.pct}% remaining</span>
          </div>
          <Bar pct={p.pct} />
          <div className="flex gap-4 mt-1.5 text-xs text-white/30">
            {p.used  !== null && <span>Used: {fmtN(p.used,  p.unit)}</span>}
            {p.limit !== null && <span>Limit: {fmtN(p.limit, p.unit)}</span>}
          </div>
          {isLow  && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Low — top up at your provider dashboard</p>}
          {isWarn && <p className="text-amber-400 text-xs mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Getting low — consider topping up soon</p>}
        </div>
      ) : (
        <div className="px-3 py-2.5 rounded-xl text-xs text-white/40" style={{ background: "rgba(255,255,255,0.04)" }}>
          {p.note ?? "Key active · Balance data not available for this account type"}
        </div>
      )}

      {p.keyConfigured && p.keyValid !== false && (
        <>
          <button onClick={() => setShow(!show)}
            className="text-xs text-white/30 hover:text-white/60 transition-all flex items-center gap-1">
            {show ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Platform usage log
          </button>
          {show && <TxnList provider={provider} />}
        </>
      )}
    </div>
  );
}

/* ─── Card: Kling / Shotstack (manual bank) ─────────────────── */

function BankCard({ p, provider, onRefresh }: { p: BankProvider; provider: string; onRefresh: () => void }) {
  const [showTopUp,   setShowTopUp]   = useState(false);
  const [showTxns,    setShowTxns]    = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReport,  setShowReport]  = useState(false);
  const color      = COLORS[provider] ?? "#00E676";
  const isLow      = p.pct !== null && p.pct <= p.alertThresholdPct;
  const isWarn     = p.pct !== null && !isLow && p.pct <= p.alertThresholdPct * 1.5;
  const isEmpty    = p.balance === null || p.totalAdded === 0;
  const isSubModel = p.billingModel === "subscription";

  const estimatedUsd = p.balance != null && p.costPerCredit
    ? p.balance * p.costPerCredit : null;

  function closeAll() { setShowTxns(false); setShowSettings(false); setShowReport(false); }

  return (
    <>
      {showTopUp && (
        <BankTopUpModal provider={provider} displayName={p.displayName}
          onClose={() => setShowTopUp(false)}
          onDone={() => { setShowTopUp(false); onRefresh(); }} />
      )}

      <div className="rounded-2xl border p-5 space-y-4"
        style={{ background: "rgba(255,255,255,0.02)", borderColor: isLow ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)" }}>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
              style={{ background: `${color}15`, border: `1px solid ${color}25` }}>{p.icon}</div>
            <div>
              <div className="text-white font-bold text-sm">{p.displayName}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <KeyBadge configured={p.keyConfigured} valid={p.keyValid} />
                {p.billingModel && <BillingBadge model={p.billingModel} />}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowTopUp(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black shrink-0 transition-all hover:scale-[1.04]"
              style={{ background: "#00E676" }}>
              <Plus className="w-3 h-3" /> Top Up
            </button>
            <a href={p.dashboardUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white border border-white/8 hover:border-white/20 transition-all shrink-0">
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Body */}
        {!p.keyConfigured ? (
          <div className="px-3 py-2.5 rounded-xl text-xs text-white/40" style={{ background: "rgba(255,255,255,0.04)" }}>
            Add <code className="font-mono text-white/60 mx-0.5">{provider.toUpperCase()}_API_KEY</code> to Replit Secrets.
          </div>
        ) : isEmpty ? (
          <div className="px-3 py-2.5 rounded-xl text-xs text-white/40 space-y-1" style={{ background: "rgba(255,255,255,0.04)" }}>
            <p>{p.note}</p>
            <p className="text-white/25">Click <strong className="text-white/40">Top Up</strong> once you've purchased credits.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Balance + subscription context */}
            <div>
              <div className="flex items-baseline justify-between">
                <div>
                  {isSubModel && p.monthlyCredits && (
                    <div className="text-[#00D4FF]/60 text-[10px] uppercase tracking-wider mb-0.5">
                      Monthly Allocation: {fmtCredits(p.monthlyCredits)} credits
                    </div>
                  )}
                  <span className="text-white text-2xl font-black">{fmtCredits(p.balance ?? 0)}</span>
                  <span className="text-base font-normal text-white/40 ml-1.5">credits</span>
                  {estimatedUsd != null && (
                    <div className="text-white/35 text-xs mt-0.5">
                      ~{fmtUsd(estimatedUsd)} estimated value
                      {p.costPerCredit && <span className="text-white/20 ml-1">@ {fmtUsd(p.costPerCredit)}/credit</span>}
                    </div>
                  )}
                </div>
                {p.pct !== null && <span className="text-white/40 text-xs">{p.pct}% remaining</span>}
              </div>
              {p.pct !== null && <Bar pct={p.pct} threshold={p.alertThresholdPct} />}
            </div>

            {/* Production stats — same for both providers */}
            <div className="grid grid-cols-3 gap-2">
              <StatBox label="Consumed" value={fmtCredits(p.totalCreditsConsumed ?? 0)}
                sub="all time" icon={ArrowDownCircle} color="#ef4444" />
              <StatBox label="Videos" value={(p.totalVideosGenerated ?? 0).toLocaleString()}
                sub="generated" icon={Video} color={color} />
              <StatBox label="Minutes" value={(p.totalMinutesGenerated ?? 0).toFixed(1)}
                sub="rendered" icon={Clock} color={color} />
            </div>

            {isLow  && <p className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Low — top up soon</p>}
            {isWarn && <p className="text-amber-400 text-xs flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Getting low</p>}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { closeAll(); setShowTxns(!showTxns); }}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-all">
            {showTxns ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Usage log
          </button>
          <span className="text-white/15">·</span>
          <button onClick={() => { closeAll(); setShowSettings(!showSettings); }}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-all">
            <Settings className="w-3 h-3" /> Settings
          </button>
          <span className="text-white/15">·</span>
          <button onClick={() => { closeAll(); setShowReport(!showReport); }}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-all">
            <BarChart2 className="w-3 h-3" /> Report
          </button>
        </div>

        {showTxns     && <TxnList provider={provider} />}
        {showSettings && <SettingsPanel provider={provider} p={p} onSaved={onRefresh} />}
        {showReport   && <CreditBankReport provider={provider} />}
      </div>
    </>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function AdminCredits() {
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);

  const { data, isLoading, isFetching, error } = useQuery<UnifiedData>({
    queryKey: ["/api/admin/credits/unified", tick],
    queryFn: async () => {
      const r = await fetch("/api/admin/credits/unified", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 60_000,
  });

  function refresh() {
    setTick((t) => t + 1);
    qc.invalidateQueries({ queryKey: ["/api/admin/credits/transactions"] });
  }

  const providers = data
    ? [
        { key: "anthropic",  p: data.anthropic  },
        { key: "openai",     p: data.openai     },
        { key: "elevenlabs", p: data.elevenlabs },
        { key: "kling",      p: data.kling      },
        { key: "shotstack",  p: data.shotstack  },
      ]
    : [];

  const alerts = data ? [
    data.elevenlabs.pct !== null && data.elevenlabs.pct <= 30 ? "ElevenLabs characters nearly exhausted" : null,
    data.kling.pct     !== null && data.kling.pct     <= data.kling.alertThresholdPct      ? "Kling credits low" : null,
    data.shotstack.pct !== null && data.shotstack.pct <= data.shotstack.alertThresholdPct ? "Shotstack credits low" : null,
    data.openai.keyValid === false   ? "OpenAI API key invalid" : null,
    data.elevenlabs.keyValid === false ? "ElevenLabs API key invalid" : null,
    data.kling.keyValid === false     ? "Kling API key invalid" : null,
    data.shotstack.keyValid === false ? "Shotstack API key invalid" : null,
  ].filter(Boolean) : [];

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">AI Provider Status</h1>
            <p className="text-white/40 text-sm mt-1">Live balances, spend tracking, and credit banks — admin only</p>
          </div>
          <button onClick={refresh} disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all text-sm disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Fetching…" : "Refresh"}
          </button>
        </div>

        {alerts.length > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-2xl border border-red-500/20 bg-red-500/5">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              {alerts.map((a, i) => <p key={i} className="text-red-400 text-sm font-semibold">{a}</p>)}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-white/30">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Checking all providers…</span>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm text-center py-10">Could not load provider status. Make sure you're signed in as admin.</p>
        )}

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map(({ key, p }) =>
              p.type === "spend" ? <SpendCard key={key} provider={key} p={p as SpendProvider} /> :
              p.type === "live"  ? <LiveCard  key={key} provider={key} p={p as LiveProvider}  /> :
                                   <BankCard  key={key} provider={key} p={p as BankProvider} onRefresh={refresh} />
            )}
          </div>
        )}

        <GiftCreditsPanel />

        <VideoAnalyticsSection />

        <div className="rounded-2xl border border-white/8 p-5 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">How each provider is tracked</p>
          <div className="space-y-1.5 text-white/35 text-sm">
            <p>🧠 <span className="text-white/55">Anthropic (Claude)</span> — Billed by Replit. We track estimated spend from token counts automatically — no action needed.</p>
            <p>🖼️ <span className="text-white/55">OpenAI</span> — Live API check. Balance shown if you're on a prepaid plan; pay-as-you-go shows key status only.</p>
            <p>🎙️ <span className="text-white/55">ElevenLabs</span> — Live character usage and monthly limit pulled directly from their API.</p>
            <p>🎬 <span className="text-white/55">Kling AI (Direct API)</span> — Credit balance tracked manually. Top up at klingai.com after purchasing; the system tracks clips and video count per generation.</p>
            <p>⚙️ <span className="text-white/55">Shotstack</span> — Credits are the primary unit. Supports both Pay-As-You-Go and Subscription. Top up after purchasing; renders are tracked with minutes and video count automatically.</p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
