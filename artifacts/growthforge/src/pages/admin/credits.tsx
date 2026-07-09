import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, ExternalLink, CheckCircle, XCircle, AlertTriangle,
  Minus, ArrowDownCircle,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface ProviderStatus {
  provider: string;
  displayName: string;
  icon: string;
  keyConfigured: boolean;
  keyValid: boolean | null;
  balance: number | null;
  used: number | null;
  limit: number | null;
  unit: string;
  pct: number | null;
  managedBy: string | null;
  dashboardUrl: string;
  error: string | null;
}

interface Transaction {
  id: number;
  provider: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  referenceId: string | null;
  createdAt: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic:  "#a78bfa",
  openai:     "#00D4FF",
  minimax:    "#00E676",
  elevenlabs: "#f59e0b",
  shotstack:  "#14F195",
};

function fmt(n: number, unit: string) {
  if (unit === "USD") return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " " + unit;
}

function BalanceBar({ pct, threshold = 30 }: { pct: number; threshold?: number }) {
  const color = pct <= threshold ? "#ef4444" : pct <= threshold * 1.5 ? "#f59e0b" : "#00E676";
  return (
    <div className="w-full h-1.5 rounded-full mt-2" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function KeyStatus({ valid }: { valid: boolean | null }) {
  if (valid === null) return null;
  return valid
    ? <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold"><CheckCircle className="w-3 h-3" /> Key valid</span>
    : <span className="flex items-center gap-1 text-red-400 text-xs font-semibold"><XCircle className="w-3 h-3" /> Key invalid</span>;
}

function ProviderCard({ p }: { p: ProviderStatus }) {
  const [showTxns, setShowTxns] = useState(false);
  const color = PROVIDER_COLORS[p.provider] ?? "#ffffff";
  const isManaged = !!p.managedBy;

  const { data: txns } = useQuery<Transaction[]>({
    queryKey: ["/api/admin/credits/live", p.provider, "transactions"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/credits/live/${p.provider}/transactions`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: showTxns,
  });

  return (
    <div
      className="rounded-2xl border p-5 space-y-4 flex flex-col"
      style={{
        background: "rgba(255,255,255,0.02)",
        borderColor: !p.keyConfigured
          ? "rgba(255,255,255,0.08)"
          : p.keyValid === false
          ? "rgba(239,68,68,0.25)"
          : isManaged
          ? `${color}20`
          : p.pct !== null && p.pct <= 30
          ? "rgba(239,68,68,0.25)"
          : "rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: `${color}15`, border: `1px solid ${color}25` }}
          >
            {p.icon}
          </div>
          <div>
            <div className="text-white font-bold text-sm">{p.displayName}</div>
            {p.managedBy
              ? <div className="text-xs mt-0.5" style={{ color }}>{p.managedBy}</div>
              : <KeyStatus valid={p.keyValid} />
            }
          </div>
        </div>
        <a
          href={p.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/40 hover:text-white border border-white/8 hover:border-white/20 transition-all shrink-0"
        >
          <ExternalLink className="w-3 h-3" /> Dashboard
        </a>
      </div>

      {!p.keyConfigured ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-white/40" style={{ background: "rgba(255,255,255,0.04)" }}>
          <Minus className="w-3 h-3 shrink-0" />
          API key not configured yet. Add <code className="font-mono text-white/60 mx-0.5">{p.provider.toUpperCase()}_API_KEY</code> to Replit Secrets.
        </div>
      ) : isManaged ? (
        <div className="px-3 py-2.5 rounded-xl text-xs text-white/40" style={{ background: "rgba(255,255,255,0.04)" }}>
          {p.error}
        </div>
      ) : (
        <>
          {p.pct !== null && p.balance !== null && p.limit !== null ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-white text-2xl font-black">{fmt(p.balance, p.unit)}</span>
                <span className="text-white/40 text-xs">{p.pct}% remaining</span>
              </div>
              <BalanceBar pct={p.pct} />
              <div className="flex gap-3 mt-2 text-xs text-white/30">
                {p.used !== null && <span>Used: {fmt(p.used, p.unit)}</span>}
                {p.limit !== null && <span>Limit: {fmt(p.limit, p.unit)}</span>}
              </div>
              {p.pct <= 30 && (
                <div className="flex items-center gap-2 mt-2 text-xs text-red-400">
                  <AlertTriangle className="w-3 h-3" /> Low — top up from your provider dashboard
                </div>
              )}
            </div>
          ) : p.keyValid ? (
            <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}>
              {p.error ?? "Key active — balance not available via API for this account type"}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-red-400" style={{ background: "rgba(239,68,68,0.06)" }}>
              <XCircle className="w-3 h-3 shrink-0" /> {p.error ?? "API key is invalid or revoked"}
            </div>
          )}

          <button
            onClick={() => setShowTxns(!showTxns)}
            className="text-xs text-white/30 hover:text-white/60 transition-all text-left"
          >
            {showTxns ? "▲ Hide" : "▼ Show"} platform usage log
          </button>

          {showTxns && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {!txns
                ? <div className="text-white/20 text-xs text-center py-3">Loading…</div>
                : txns.length === 0
                ? <div className="text-white/20 text-xs text-center py-3">No usage logged yet</div>
                : txns.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-white/60 text-xs truncate">{t.description}</div>
                      <div className="text-white/25 text-[10px]">{new Date(t.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-red-400 text-xs font-bold shrink-0">
                      -{t.amount.toLocaleString()}
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminCredits() {
  const qc = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: providers, isLoading, error, isFetching } = useQuery<ProviderStatus[]>({
    queryKey: ["/api/admin/credits/live", refreshKey],
    queryFn: async () => {
      const r = await fetch("/api/admin/credits/live", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 60_000,
  });

  function refresh() {
    setRefreshKey((k) => k + 1);
    qc.invalidateQueries({ queryKey: ["/api/admin/credits/live"] });
  }

  const configured = providers?.filter((p) => p.keyConfigured && !p.managedBy) ?? [];
  const invalid = configured.filter((p) => p.keyValid === false);
  const low = configured.filter((p) => p.pct !== null && p.pct <= 30);

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">AI Provider Status</h1>
            <p className="text-white/40 text-sm mt-1">Live balances pulled directly from each provider's API — admin only</p>
          </div>
          <button
            onClick={refresh}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-all text-sm disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Fetching…" : "Refresh"}
          </button>
        </div>

        {(invalid.length > 0 || low.length > 0) && (
          <div className="space-y-2">
            {invalid.length > 0 && (
              <div className="flex items-center gap-3 p-4 rounded-2xl border border-red-500/20 bg-red-500/5">
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                <span className="text-red-400 text-sm font-semibold">
                  {invalid.length} provider{invalid.length > 1 ? "s have" : " has"} an invalid API key
                </span>
              </div>
            )}
            {low.length > 0 && (
              <div className="flex items-center gap-3 p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <span className="text-amber-400 text-sm font-semibold">
                  {low.map((p) => p.displayName).join(", ")} {low.length > 1 ? "are" : "is"} below 30% — top up soon
                </span>
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-white/30">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Checking provider APIs…</span>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm text-center py-10">
            Could not load provider status. Make sure you're signed in as admin.
          </div>
        )}

        {providers && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map((p) => <ProviderCard key={p.provider} p={p} />)}
          </div>
        )}

        <div className="rounded-2xl border border-white/8 p-5 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">How balances work</div>
          <div className="space-y-1.5 text-white/35 text-sm">
            <p>• <span className="text-white/55">Anthropic (Claude)</span> — billed through Replit. No balance to track here.</p>
            <p>• <span className="text-white/55">ElevenLabs</span> — shows your real character usage and monthly limit from their API.</p>
            <p>• <span className="text-white/55">OpenAI</span> — verifies your key is active; credit balance shown if you're on a prepaid plan.</p>
            <p>• <span className="text-white/55">MiniMax & Shotstack</span> — verifies your key; balance requires checking their dashboard directly.</p>
            <p>• The usage log below each provider shows what your platform customers have consumed.</p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
