import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, ExternalLink, CheckCircle, XCircle, AlertTriangle,
  Minus, ArrowUpCircle, ArrowDownCircle, ChevronDown, ChevronUp,
  Plus, Settings,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

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
}
interface UnifiedData {
  anthropic:  SpendProvider;
  openai:     LiveProvider;
  elevenlabs: LiveProvider;
  minimax:    BankProvider;
  shotstack:  BankProvider;
}
interface Transaction {
  id: number; provider: string; type: string; amount: number;
  balanceAfter: number; description: string; createdAt: string;
}

/* ─── Helpers ────────────────────────────────────────────────── */

const COLORS: Record<string, string> = {
  anthropic: "#a78bfa", openai: "#00D4FF", elevenlabs: "#f59e0b",
  minimax: "#00E676", shotstack: "#14F195",
};

function fmtN(n: number, unit: string) {
  if (unit === "USD") return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " " + unit;
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

function TxnList({ provider }: { provider: string }) {
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
        <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
          {t.type === "topup"
            ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-white/60 text-xs truncate">{t.description}</div>
            <div className="text-white/25 text-[10px]">{new Date(t.createdAt).toLocaleString()}</div>
          </div>
          <div className={`text-xs font-bold shrink-0 ${t.type === "topup" ? "text-emerald-400" : "text-red-400"}`}>
            {t.type === "topup" ? "+" : "-"}{t.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </div>
        </div>
      ))}
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

/* ─── Card: MiniMax / Shotstack (manual bank) ────────────────── */

function TopUpModal({ provider, displayName, unit, onClose, onDone }: {
  provider: string; displayName: string; unit: string;
  onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setErr("Enter a positive amount"); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/admin/credits/bank/${provider}/topup`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, notes }),
      });
      if (!r.ok) throw new Error(await r.text());
      onDone();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6 space-y-4" style={{ background: "#0d1b2e" }}>
        <div className="text-white font-bold text-lg">Top Up {displayName}</div>
        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1.5">Amount ({unit})</label>
          <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 100"
            className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-white/30 transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
        <div>
          <label className="text-white/50 text-xs uppercase tracking-widest block mb-1.5">Notes (optional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={`e.g. ${displayName} invoice #1234`}
            className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none border border-white/10 focus:border-white/30 transition-all"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
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

function AlertPanel({ provider, p, onSaved }: { provider: string; p: BankProvider; onSaved: () => void }) {
  const [threshold, setThreshold] = useState(String(p.alertThresholdPct));
  const [email, setEmail] = useState(p.alertEmail ?? "");
  const [enabled, setEnabled] = useState(p.alertEnabled);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/credits/bank/${provider}/settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertThresholdPct: parseInt(threshold, 10), alertEmail: email, alertEnabled: enabled }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(true);
      setTimeout(() => { setSaved(false); onSaved(); }, 1200);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-3 pt-3 border-t border-white/8">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-white/40 text-xs uppercase tracking-widest block mb-1">Alert at %</label>
          <input type="number" min="1" max="99" value={threshold} onChange={(e) => setThreshold(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
        <div>
          <label className="text-white/40 text-xs uppercase tracking-widest block mb-1">Alert email</label>
          <input type="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-white/30 outline-none"
            style={{ background: "rgba(255,255,255,0.06)" }} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-white/60 text-sm">Email alerts</span>
        <button onClick={() => setEnabled(!enabled)}
          className="relative w-10 h-5 rounded-full transition-all" style={{ background: enabled ? "#00E676" : "rgba(255,255,255,0.1)" }}>
          <div className={`absolute top-0.5 w-4 h-4 bg-black rounded-full transition-all ${enabled ? "left-5" : "left-0.5"}`} />
        </button>
      </div>
      <button onClick={save} disabled={loading}
        className="px-4 py-2 rounded-lg text-xs font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{ background: saved ? "#14F195" : "#00E676" }}>
        {saved ? "✓ Saved" : loading ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

function BankCard({ p, provider, onRefresh }: { p: BankProvider; provider: string; onRefresh: () => void }) {
  const [showTopUp, setShowTopUp] = useState(false);
  const [showTxns, setShowTxns] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const color = COLORS[provider] ?? "#00E676";
  const isLow  = p.pct !== null && p.pct <= p.alertThresholdPct;
  const isWarn = p.pct !== null && !isLow && p.pct <= p.alertThresholdPct * 1.5;
  const isEmpty = p.balance === null || p.totalAdded === 0;

  return (
    <>
      {showTopUp && (
        <TopUpModal provider={provider} displayName={p.displayName} unit={p.unit}
          onClose={() => setShowTopUp(false)}
          onDone={() => { setShowTopUp(false); onRefresh(); }} />
      )}
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
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-white text-2xl font-black">{(p.balance ?? 0).toLocaleString()} <span className="text-base font-normal text-white/40">{p.unit}</span></span>
              {p.pct !== null && <span className="text-white/40 text-xs">{p.pct}% remaining</span>}
            </div>
            {p.pct !== null && <Bar pct={p.pct} threshold={p.alertThresholdPct} />}
            <div className="flex gap-4 mt-1.5 text-xs text-white/30">
              {p.totalAdded !== null && <span>Purchased: {p.totalAdded.toLocaleString()}</span>}
              {p.totalAdded !== null && p.balance !== null && <span>Used: {(p.totalAdded - p.balance).toLocaleString()}</span>}
            </div>
            {isLow  && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Low — top up soon</p>}
            {isWarn && <p className="text-amber-400 text-xs mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Getting low</p>}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => { setShowTxns(!showTxns); setShowAlert(false); }}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-all">
            {showTxns ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Usage log
          </button>
          <span className="text-white/15">·</span>
          <button onClick={() => { setShowAlert(!showAlert); setShowTxns(false); }}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-all">
            <Settings className="w-3 h-3" /> Alerts
          </button>
        </div>

        {showTxns && <TxnList provider={provider} />}
        {showAlert && <AlertPanel provider={provider} p={p} onSaved={onRefresh} />}
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
        { key: "minimax",    p: data.minimax    },
        { key: "shotstack",  p: data.shotstack  },
      ]
    : [];

  const alerts = data ? [
    data.elevenlabs.pct !== null && data.elevenlabs.pct <= 30 ? "ElevenLabs characters nearly exhausted" : null,
    data.minimax.pct   !== null && data.minimax.pct   <= data.minimax.alertThresholdPct   ? "MiniMax credits low" : null,
    data.shotstack.pct !== null && data.shotstack.pct <= data.shotstack.alertThresholdPct ? "Shotstack credits low" : null,
    data.openai.keyValid === false   ? "OpenAI API key invalid" : null,
    data.elevenlabs.keyValid === false ? "ElevenLabs API key invalid" : null,
    data.minimax.keyValid === false  ? "MiniMax API key invalid" : null,
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

        <div className="rounded-2xl border border-white/8 p-5 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-widest mb-3">How each provider is tracked</p>
          <div className="space-y-1.5 text-white/35 text-sm">
            <p>🧠 <span className="text-white/55">Anthropic (Claude)</span> — Billed by Replit. We track estimated spend from token counts automatically — no action needed.</p>
            <p>🖼️ <span className="text-white/55">OpenAI</span> — Live API check. Balance shown if you're on a prepaid plan; pay-as-you-go shows key status only.</p>
            <p>🎙️ <span className="text-white/55">ElevenLabs</span> — Live character usage and monthly limit pulled directly from their API.</p>
            <p>🎬 <span className="text-white/55">MiniMax</span> — Their API doesn't expose balance. Top up here after purchasing, and the system auto-deducts each video generation.</p>
            <p>⚙️ <span className="text-white/55">Shotstack</span> — Same as MiniMax. Top up here and the system tracks each render automatically.</p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
