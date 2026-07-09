import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Plus, Settings, ChevronDown, ChevronUp, RefreshCw, ArrowUpCircle, ArrowDownCircle,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface Bank {
  id: number;
  provider: string;
  displayName: string;
  unit: string;
  balance: number;
  peakBalance: number;
  totalAdded: number;
  alertThresholdPct: number;
  alertEmail: string | null;
  alertEnabled: boolean;
  lastAlertAt: string | null;
  notes: string | null;
  updatedAt: string;
}

interface Transaction {
  id: number;
  provider: string;
  type: "topup" | "deduction";
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

const PROVIDER_ICONS: Record<string, string> = {
  anthropic:  "🧠",
  openai:     "🖼️",
  minimax:    "🎬",
  elevenlabs: "🎙️",
  shotstack:  "⚙️",
};

function fmt(n: number, unit: string) {
  if (unit === "USD") return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}

function pct(bank: Bank) {
  if (bank.peakBalance <= 0) return 100;
  return Math.min(100, Math.round((bank.balance / bank.peakBalance) * 100));
}

function BalanceBar({ value, threshold }: { value: number; threshold: number }) {
  const color = value <= threshold ? "#ef4444" : value <= threshold * 1.5 ? "#f59e0b" : "#00E676";
  return (
    <div className="w-full h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div
        className="h-2 rounded-full transition-all duration-500"
        style={{ width: `${value}%`, background: color }}
      />
    </div>
  );
}

function TopUpModal({ bank, onClose, onSuccess }: { bank: Bank; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setError("Enter a positive amount"); return; }
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/credits/${bank.provider}/topup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, notes }),
      });
      if (!r.ok) throw new Error(await r.text());
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6 space-y-4" style={{ background: "#0d1b2e" }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{PROVIDER_ICONS[bank.provider] ?? "💳"}</span>
          <div>
            <div className="text-white font-bold text-lg">Top Up {bank.displayName}</div>
            <div className="text-white/40 text-sm">Current: {fmt(bank.balance, bank.unit)}</div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-widest block mb-1.5">
              Amount ({bank.unit})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`e.g. 1000`}
              className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-white/30 transition-all"
              style={{ background: "rgba(255,255,255,0.06)" }}
            />
          </div>
          <div>
            <label className="text-white/60 text-xs font-semibold uppercase tracking-widest block mb-1.5">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. MiniMax invoice #1234"
              className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-white/30 transition-all"
              style={{ background: "rgba(255,255,255,0.06)" }}
            />
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white/50 border border-white/10 hover:text-white hover:border-white/30 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: "#00E676" }}
          >
            {loading ? "Adding…" : "Add Credits"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ bank, onSave }: { bank: Bank; onSave: () => void }) {
  const [threshold, setThreshold] = useState(String(bank.alertThresholdPct));
  const [email, setEmail] = useState(bank.alertEmail ?? "");
  const [enabled, setEnabled] = useState(bank.alertEnabled);
  const [unit, setUnit] = useState(bank.unit);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/credits/${bank.provider}/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertThresholdPct: parseInt(threshold, 10),
          alertEmail: email,
          alertEnabled: enabled,
          unit,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(true);
      setTimeout(() => { setSaved(false); onSave(); }, 1200);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 pt-4 border-t border-white/8">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1">Alert Threshold %</label>
          <input
            type="number" min="1" max="99" value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }}
          />
        </div>
        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1">Credit Unit Label</label>
          <input
            type="text" value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }}
          />
        </div>
      </div>
      <div>
        <label className="text-white/50 text-xs uppercase tracking-widest block mb-1">Alert Email</label>
        <input
          type="email" value={email} placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none transition-all"
          style={{ background: "rgba(255,255,255,0.06)" }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-white/70 text-sm font-medium">Email alerts enabled</div>
          <div className="text-white/30 text-xs">Requires SMTP_HOST to be configured</div>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className="relative w-11 h-6 rounded-full transition-all"
          style={{ background: enabled ? "#00E676" : "rgba(255,255,255,0.1)" }}
        >
          <div className={`absolute top-1 w-4 h-4 bg-black rounded-full transition-all ${enabled ? "left-6" : "left-1"}`} />
        </button>
      </div>
      <button
        onClick={save}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-xs font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{ background: saved ? "#14F195" : "#00E676" }}
      >
        {saved ? "✓ Saved" : loading ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

function BankCard({ bank, onRefresh }: { bank: Bank; onRefresh: () => void }) {
  const [showTxns, setShowTxns] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);

  const { data: txns } = useQuery<Transaction[]>({
    queryKey: ["/api/admin/credits", bank.provider, "transactions"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/credits/${bank.provider}/transactions?limit=20`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: showTxns,
  });

  const balancePct = pct(bank);
  const isLow = balancePct <= bank.alertThresholdPct;
  const isWarning = !isLow && balancePct <= bank.alertThresholdPct * 1.5;
  const color = PROVIDER_COLORS[bank.provider] ?? "#ffffff";

  return (
    <>
      {showTopUp && (
        <TopUpModal
          bank={bank}
          onClose={() => setShowTopUp(false)}
          onSuccess={() => { setShowTopUp(false); onRefresh(); }}
        />
      )}

      <div
        className="rounded-2xl border p-5 space-y-4 transition-all"
        style={{
          background: "rgba(255,255,255,0.02)",
          borderColor: isLow ? "rgba(239,68,68,0.3)" : isWarning ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
              style={{ background: `${color}18`, border: `1px solid ${color}30` }}
            >
              {PROVIDER_ICONS[bank.provider] ?? "💳"}
            </div>
            <div>
              <div className="text-white font-bold text-sm">{bank.displayName}</div>
              <div className="text-white/40 text-xs mt-0.5">
                {isLow
                  ? <span className="text-red-400 font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Low balance</span>
                  : isWarning
                  ? <span className="text-amber-400 font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Getting low</span>
                  : <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Healthy</span>
                }
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowTopUp(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black shrink-0 transition-all hover:scale-[1.04]"
            style={{ background: "#00E676" }}
          >
            <Plus className="w-3 h-3" /> Top Up
          </button>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-white text-2xl font-black">{fmt(bank.balance, bank.unit)}</span>
            <span className="text-white/40 text-xs">{balancePct}% remaining</span>
          </div>
          <BalanceBar value={balancePct} threshold={bank.alertThresholdPct} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="text-white/40 text-xs mb-0.5">Total added</div>
            <div className="text-white font-semibold text-sm">{fmt(bank.totalAdded, bank.unit)}</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="text-white/40 text-xs mb-0.5">Total used</div>
            <div className="text-white font-semibold text-sm">{fmt(bank.totalAdded - bank.balance, bank.unit)}</div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { setShowTxns(!showTxns); setShowSettings(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white border border-white/8 hover:border-white/20 transition-all"
          >
            {showTxns ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            History
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowTxns(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white border border-white/8 hover:border-white/20 transition-all"
          >
            <Settings className="w-3 h-3" />
            Alert settings
          </button>
        </div>

        {showTxns && (
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {!txns
              ? <div className="text-white/30 text-xs text-center py-4">Loading…</div>
              : txns.length === 0
              ? <div className="text-white/30 text-xs text-center py-4">No transactions yet</div>
              : txns.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                  {t.type === "topup"
                    ? <ArrowUpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <ArrowDownCircle className="w-4 h-4 text-red-400 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-white/70 text-xs truncate">{t.description}</div>
                    <div className="text-white/30 text-[10px]">{new Date(t.createdAt).toLocaleString()}</div>
                  </div>
                  <div className={`text-xs font-bold shrink-0 ${t.type === "topup" ? "text-emerald-400" : "text-red-400"}`}>
                    {t.type === "topup" ? "+" : "-"}{fmt(t.amount, bank.unit)}
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {showSettings && <SettingsPanel bank={bank} onSave={onRefresh} />}
      </div>
    </>
  );
}

export default function AdminCredits() {
  const qc = useQueryClient();
  const { data: banks, isLoading, error } = useQuery<Bank[]>({
    queryKey: ["/api/admin/credits"],
    queryFn: async () => {
      const r = await fetch("/api/admin/credits", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  function refresh() { qc.invalidateQueries({ queryKey: ["/api/admin/credits"] }); }

  const totalLow = banks?.filter((b) => pct(b) <= b.alertThresholdPct).length ?? 0;
  const totalWarning = banks?.filter((b) => { const p = pct(b); return p > b.alertThresholdPct && p <= b.alertThresholdPct * 1.5; }).length ?? 0;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Credit Banks</h1>
            <p className="text-white/40 text-sm mt-1">Manage AI provider credit balances — only visible to you</p>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-all text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {(totalLow > 0 || totalWarning > 0) && (
          <div
            className="flex items-start gap-3 p-4 rounded-2xl border"
            style={{
              background: totalLow > 0 ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)",
              borderColor: totalLow > 0 ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
            }}
          >
            <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${totalLow > 0 ? "text-red-400" : "text-amber-400"}`} />
            <div>
              <div className={`font-semibold text-sm ${totalLow > 0 ? "text-red-400" : "text-amber-400"}`}>
                {totalLow > 0
                  ? `${totalLow} bank${totalLow > 1 ? "s are" : " is"} critically low — top up to avoid service interruptions`
                  : `${totalWarning} bank${totalWarning > 1 ? "s are" : " is"} getting low — consider topping up soon`
                }
              </div>
              <div className="text-white/40 text-xs mt-0.5">Configure an alert email in each bank's settings to receive automatic warnings</div>
            </div>
          </div>
        )}

        {banks && banks.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: "Banks", value: banks.length, icon: <Wallet className="w-4 h-4" />, color: "#00E676" },
              { label: "Critical", value: totalLow, icon: <AlertTriangle className="w-4 h-4" />, color: "#ef4444" },
              { label: "Warning", value: totalWarning, icon: <AlertTriangle className="w-4 h-4" />, color: "#f59e0b" },
              { label: "Healthy", value: (banks.length - totalLow - totalWarning), icon: <CheckCircle className="w-4 h-4" />, color: "#14F195" },
              {
                label: "Total Used (USD)",
                value: `$${banks.filter(b => b.unit === "USD").reduce((s, b) => s + (b.totalAdded - b.balance), 0).toFixed(2)}`,
                icon: <TrendingDown className="w-4 h-4" />, color: "#00D4FF",
              },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="rounded-xl p-4 border border-white/8" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="flex items-center gap-2 mb-2" style={{ color }}>
                  {icon}
                  <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">{label}</span>
                </div>
                <div className="text-white text-xl font-black">{value}</div>
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-white/30 gap-3">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading banks…
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm text-center py-8">Failed to load credit banks. Make sure you're signed in as admin.</div>
        )}

        {banks && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {banks.map((bank) => (
              <BankCard key={bank.provider} bank={bank} onRefresh={refresh} />
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-white/8 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4" style={{ color: "#00E676" }} />
            <span className="text-white/60 text-xs font-semibold uppercase tracking-widest">How it works</span>
          </div>
          <ul className="space-y-1.5 text-white/40 text-sm">
            <li>• Each bank tracks credits for one AI provider independently in the unit you define</li>
            <li>• Credits are deducted automatically as your customers use platform features</li>
            <li>• Top up by entering the amount you purchased from the provider's dashboard</li>
            <li>• Email alerts fire when balance drops below your threshold (requires SMTP_HOST secret)</li>
            <li>• All balances are admin-only — customers never see this information</li>
          </ul>
        </div>
      </div>
    </AdminLayout>
  );
}
