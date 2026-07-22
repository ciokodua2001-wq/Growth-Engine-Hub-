import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Zap, Plus, AlertTriangle, Clock, ShoppingBag, ChevronDown, ChevronUp } from "lucide-react";

interface VideoWalletBalance {
  monthlySecondsTotal: number;
  monthlySecondsUsed: number;
  monthlySecondsRemaining: number;
  purchasedSecondsRemaining: number;
  totalRemaining: number;
  plan: string;
  lastResetAt: string;
}

interface CreditBundle {
  seconds: number;
  priceUsd: number;
  label: string;
}

interface WalletData {
  balance: VideoWalletBalance;
  lowMonthlyBalance: boolean;
  pctMonthlyLeft: number;
  bundles: CreditBundle[];
  retailPricePerSecond: number;
}

function fmtSec(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function Bar({ pct, low }: { pct: number; low: boolean }) {
  const color = pct <= 10 ? "#ef4444" : low ? "#f59e0b" : "#00E676";
  return (
    <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div
        className="h-1.5 rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
      />
    </div>
  );
}

function PurchaseModal({
  bundles,
  onClose,
}: {
  bundles: CreditBundle[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");

  async function purchase() {
    if (selected === null) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/stripe/checkout/video-credits", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ seconds: selected }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Failed to create checkout session");
      }
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 p-6 space-y-5"
        style={{ background: "#0d1b2e" }}
      >
        <div>
          <div className="text-white font-bold text-lg">Buy Video Credits</div>
          <div className="text-white/40 text-xs mt-0.5">Purchased seconds never expire</div>
        </div>

        <div className="space-y-2">
          {bundles.map((b) => (
            <button
              key={b.seconds}
              onClick={() => setSelected(b.seconds)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all"
              style={{
                background: selected === b.seconds ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.03)",
                borderColor: selected === b.seconds ? "rgba(0,230,118,0.4)" : "rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,230,118,0.12)" }}
                >
                  <Clock className="w-3.5 h-3.5" style={{ color: "#00E676" }} />
                </div>
                <div className="text-left">
                  <div className="text-white text-sm font-semibold">{b.label}</div>
                  <div className="text-white/35 text-xs">≈ {Math.floor(b.seconds / 15)} promo videos</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-white font-bold">${b.priceUsd.toFixed(2)}</div>
                <div className="text-white/30 text-[10px]">${(b.priceUsd / b.seconds).toFixed(2)}/s</div>
              </div>
            </button>
          ))}
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white/50 border border-white/10 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={purchase}
            disabled={selected === null || loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-40"
            style={{ background: "#00E676" }}
          >
            {loading ? "Redirecting…" : "Buy Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VideoWalletWidget({ compact = false }: { compact?: boolean }) {
  const [showPurchase, setShowPurchase] = useState(false);
  const [expanded, setExpanded]         = useState(false);

  const { data, isLoading, error } = useQuery<WalletData>({
    queryKey: ["/api/video-wallet"],
    queryFn: async () => {
      const res = await fetch("/api/video-wallet", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load wallet");
      return res.json() as Promise<WalletData>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading || error || !data) return null;

  const { balance, lowMonthlyBalance, pctMonthlyLeft, bundles } = data;
  const totalRemaining = balance.totalRemaining;
  const hasPurchased   = balance.purchasedSecondsRemaining > 0;

  if (compact) {
    return (
      <>
        <button
          onClick={() => setShowPurchase(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:scale-[1.02]"
          style={{
            background:   totalRemaining === 0 ? "rgba(239,68,68,0.12)" : "rgba(0,230,118,0.08)",
            borderColor:  totalRemaining === 0 ? "rgba(239,68,68,0.3)"  : "rgba(0,230,118,0.25)",
            color:        totalRemaining === 0 ? "#ef4444"              : "#00E676",
          }}
        >
          <Zap className="w-3 h-3" />
          {fmtSec(totalRemaining)} left
          {lowMonthlyBalance && <AlertTriangle className="w-3 h-3" />}
        </button>
        {showPurchase && <PurchaseModal bundles={bundles} onClose={() => setShowPurchase(false)} />}
      </>
    );
  }

  return (
    <>
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{
          background:  "rgba(255,255,255,0.02)",
          borderColor: lowMonthlyBalance && !hasPurchased
            ? "rgba(245,158,11,0.2)"
            : "rgba(255,255,255,0.07)",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(0,230,118,0.1)" }}
            >
              <Zap className="w-3.5 h-3.5" style={{ color: "#00E676" }} />
            </div>
            <div>
              <div className="text-white text-sm font-bold">Video Credits</div>
              <div className="text-white/35 text-[10px]">Monthly allowance</div>
            </div>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Monthly pool */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-white/40 text-xs">Monthly</span>
            <span className="text-white text-xs font-semibold">
              {fmtSec(balance.monthlySecondsRemaining)}
              <span className="text-white/30 font-normal"> / {fmtSec(balance.monthlySecondsTotal)}</span>
            </span>
          </div>
          <Bar pct={pctMonthlyLeft} low={lowMonthlyBalance} />
        </div>

        {/* Purchased pool */}
        {hasPurchased && (
          <div className="flex justify-between items-center py-1.5 px-2.5 rounded-lg" style={{ background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.12)" }}>
            <span className="text-[#00D4FF]/70 text-xs flex items-center gap-1.5">
              <ShoppingBag className="w-3 h-3" /> Purchased credits
            </span>
            <span className="text-[#00D4FF] text-xs font-bold">{fmtSec(balance.purchasedSecondsRemaining)}</span>
          </div>
        )}

        {lowMonthlyBalance && !hasPurchased && balance.monthlySecondsTotal > 0 && (
          <div
            className="flex items-start gap-2 px-2.5 py-2 rounded-lg text-xs"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)" }}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-300/80">
              {balance.monthlySecondsRemaining === 0
                ? "Monthly video allowance used up."
                : `Only ${fmtSec(balance.monthlySecondsRemaining)} left this month.`}{" "}
              Purchase extra seconds to keep creating.
            </span>
          </div>
        )}

        {expanded && (
          <div className="pt-1 space-y-1 text-[10px] text-white/30">
            <div className="flex justify-between">
              <span>Total remaining</span>
              <span className="text-white/50 font-semibold">{fmtSec(totalRemaining)}</span>
            </div>
            <div className="flex justify-between">
              <span>Plan</span>
              <span className="text-white/50 capitalize">{balance.plan}</span>
            </div>
            <div className="flex justify-between">
              <span>Resets</span>
              <span className="text-white/50">1st of each month</span>
            </div>
          </div>
        )}

        <button
          onClick={() => setShowPurchase(true)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold text-black transition-all hover:scale-[1.02]"
          style={{ background: "#00E676" }}
        >
          <Plus className="w-3.5 h-3.5" />
          Buy More Seconds
        </button>
      </div>

      {showPurchase && <PurchaseModal bundles={bundles} onClose={() => setShowPurchase(false)} />}
    </>
  );
}
