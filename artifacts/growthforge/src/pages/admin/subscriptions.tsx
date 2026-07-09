import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, Users, AlertTriangle, ShieldOff, Shield,
  FileText, Download, Bell, ChevronRight, X, Clock, Video, Zap,
  CheckCircle, XCircle,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";
import StatCard from "@/components/admin/stat-card";

/* ── Types ──────────────────────────────────────────────── */

interface AdminAlert {
  id: number;
  type: "threshold_crossed" | "video_rendered" | "chargeback_flagged";
  userId: string;
  userEmail: string | null;
  planName: string | null;
  consumedUsd: number | null;
  ceilingUsd: number | null;
  consumedPct: number | null;
  dismissed: boolean;
  createdAt: string;
}

interface SubscriberRow {
  id: string;
  email: string | null;
  plan: string;
  subscriptionStatus: string;
  createdAt: string;
  consumedUsd: number;
  ceilingUsd: number;
  consumedPct: number;
  hasVideoRender: boolean;
  eligibility: "eligible" | "borderline" | "non_refundable";
  eligibilityReason: string;
  withinWindow: boolean;
  eventCount: number;
}

interface SubscriberUsage {
  subscriber: SubscriberRow;
  events: {
    id: number;
    feature: string;
    amount: number;
    costUsd: number;
    isVideoRender: boolean;
    createdAt: string;
  }[];
}

interface Stats {
  totalUsers: number;
  trialUsers: number;
  paidUsers: number;
  cancelledUsers: number;
  monthlyRevenue: number;
  annualRevenue: number;
}

/* ── Helpers ─────────────────────────────────────────────── */

const BADGE_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  eligible:      { bg: "#00E676/10", text: "#00E676",  border: "#00E676/25", label: "ELIGIBLE" },
  borderline:    { bg: "#f59e0b/10", text: "#f59e0b",  border: "#f59e0b/30", label: "BORDERLINE" },
  non_refundable: { bg: "#ef4444/10", text: "#ef4444", border: "#ef4444/30", label: "NON-REFUNDABLE" },
};

const REASON_LABEL: Record<string, string> = {
  within_window:        "Within 3-day window",
  approaching_threshold: "Approaching usage threshold",
  threshold_exceeded:   "Usage threshold exceeded",
  video_rendered:       "Video render initiated",
  window_expired:       "3-day window expired",
};

const PLAN_PRICES: Record<string, number> = {
  starter: 39, "get-going": 99, growth: 299, agency: 799,
};

function planColor(plan: string) {
  const colors: Record<string, string> = {
    starter: "#00E676", "get-going": "#00D4FF", growth: "#a78bfa", agency: "#f59e0b",
  };
  return colors[plan] ?? "#7a8fa6";
}

function fmtUsd(v: number) {
  return v < 0.01 ? "$0.00" : `$${v.toFixed(3)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function AlertTypeIcon({ type }: { type: AdminAlert["type"] }) {
  if (type === "threshold_crossed") return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (type === "video_rendered")    return <Video className="w-4 h-4 text-purple-400" />;
  return <ShieldOff className="w-4 h-4 text-red-400" />;
}

/* ── Threshold + usage bar ───────────────────────────────── */

function UsageBar({ pct, eligibility }: { pct: number; eligibility: string }) {
  const THRESHOLD_PCT = 15; // display cursor at 15%
  const fillColor =
    eligibility === "non_refundable" ? "#ef4444" :
    eligibility === "borderline"     ? "#f59e0b" : "#00E676";
  const clampedPct = Math.min(pct * 100, 100);

  return (
    <div className="relative w-full">
      <div className="relative h-2 rounded-full bg-white/8 overflow-visible">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${clampedPct}%`, background: fillColor }}
        />
        {/* Threshold cursor at 15% */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 rounded-full bg-white/40 z-10"
          style={{ left: `${THRESHOLD_PCT}%` }}
          title="Refund ineligibility threshold"
        />
      </div>
      <div className="flex justify-between text-[10px] text-white/25 mt-0.5">
        <span>{fmtUsd(0)}</span>
        <span className="text-white/20">│ threshold</span>
        <span>ceiling</span>
      </div>
    </div>
  );
}

/* ── Usage Detail Drawer ─────────────────────────────────── */

function UsageDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const { data, isLoading } = useQuery<SubscriberUsage>({
    queryKey: ["/api/admin/subscribers", userId, "usage"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/subscribers/${userId}/usage`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  async function downloadRebuttal() {
    window.open(`/api/admin/subscribers/${userId}/rebuttal-report`, "_blank");
  }

  async function flagChargeback() {
    setFlagging(true);
    try {
      await fetch(`/api/admin/subscribers/${userId}/flag-chargeback`, {
        method: "POST",
        credentials: "include",
      });
      setFlagged(true);
    } catch { /* ignore */ }
    setFlagging(false);
  }

  const sub = data?.subscriber;
  const events = data?.events ?? [];
  const badge = BADGE_STYLE[sub?.eligibility ?? "eligible"];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full overflow-y-auto border-l border-white/8 flex flex-col"
        style={{ background: "#080f1e" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/8">
          <div>
            <div className="font-bold text-white text-lg">{sub?.email ?? "Loading…"}</div>
            <div className="text-white/40 text-sm capitalize">{sub?.plan} plan · {sub?.subscriptionStatus}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center flex-1 text-white/30 text-sm">Loading usage data…</div>
        ) : !sub ? (
          <div className="flex items-center justify-center flex-1 text-white/30 text-sm">No data found.</div>
        ) : (
          <>
            {/* Eligibility summary */}
            <div className="p-6 border-b border-white/6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-white/30 font-semibold uppercase tracking-widest">Refund Eligibility</span>
                <span
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold"
                  style={{
                    background: `${badge.text}18`,
                    color: badge.text,
                    border: `1px solid ${badge.text}30`,
                  }}
                >
                  {badge.label}
                </span>
              </div>
              <div className="text-white/40 text-xs mb-4">{REASON_LABEL[sub.eligibilityReason]}</div>
              <UsageBar pct={sub.consumedPct} eligibility={sub.eligibility} />
              <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                <div className="p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className="text-lg font-bold text-white">{fmtUsd(sub.consumedUsd)}</div>
                  <div className="text-[10px] text-white/30 mt-0.5">AI consumed</div>
                </div>
                <div className="p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className="text-lg font-bold text-white">{(sub.consumedPct * 100).toFixed(1)}%</div>
                  <div className="text-[10px] text-white/30 mt-0.5">of ceiling</div>
                </div>
                <div className="p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className="text-lg font-bold text-white">{fmtUsd(sub.ceilingUsd)}</div>
                  <div className="text-[10px] text-white/30 mt-0.5">ceiling</div>
                </div>
              </div>
              {sub.hasVideoRender && (
                <div className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-purple-500/8 border border-purple-500/20 text-xs text-purple-300">
                  <Video className="w-3.5 h-3.5 shrink-0" />
                  Video render initiated — subscription is fully earned regardless of other usage.
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-b border-white/6 flex gap-3">
              <button
                onClick={downloadRebuttal}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-white/4 hover:bg-white/8 text-white/70 hover:text-white transition-all text-sm"
              >
                <Download className="w-4 h-4" />
                Download Rebuttal PDF
              </button>
              <button
                onClick={flagChargeback}
                disabled={flagging || flagged}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm transition-all"
                style={flagged
                  ? { borderColor: "#00E67630", background: "#00E67610", color: "#00E676" }
                  : { borderColor: "#ef444430", background: "#ef444408", color: "#ef4444" }
                }
              >
                {flagged
                  ? <><CheckCircle className="w-4 h-4" /> Chargeback Flagged</>
                  : flagging
                  ? <><Zap className="w-4 h-4 animate-pulse" /> Flagging…</>
                  : <><ShieldOff className="w-4 h-4" /> Flag Chargeback</>
                }
              </button>
            </div>

            {/* Usage event log */}
            <div className="p-6 flex-1">
              <div className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-4">
                Usage Log ({events.length} events)
              </div>
              {events.length === 0 ? (
                <div className="text-white/20 text-sm text-center py-8">No usage events recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {events.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between p-3 rounded-xl bg-white/2 border border-white/5 text-sm">
                      <div className="flex items-center gap-3">
                        {ev.isVideoRender
                          ? <Video className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          : <Zap className="w-3.5 h-3.5 text-white/30 shrink-0" />
                        }
                        <div>
                          <div className="text-white/80 capitalize">{ev.feature.replace(/_/g, " ")} ×{ev.amount}</div>
                          <div className="text-white/30 text-xs">{fmtDate(ev.createdAt)}</div>
                        </div>
                      </div>
                      <span className="text-white/50 text-xs font-mono">{fmtUsd(ev.costUsd)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */

export default function AdminSubscriptions() {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => {
      const r = await fetch("/api/admin/stats", { credentials: "include" });
      return r.json();
    },
  });

  const { data: subscribersData } = useQuery<{ subscribers: SubscriberRow[]; total: number }>({
    queryKey: ["/api/admin/subscribers"],
    queryFn: async () => {
      const r = await fetch("/api/admin/subscribers", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: alertsData } = useQuery<{ alerts: AdminAlert[] }>({
    queryKey: ["/api/admin/alerts"],
    queryFn: async () => {
      const r = await fetch("/api/admin/alerts", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const dismissAlert = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/admin/alerts/${id}/dismiss`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/alerts"] }),
  });

  const subscribers = subscribersData?.subscribers ?? [];
  const alerts = alertsData?.alerts?.filter((a) => !a.dismissed) ?? [];

  const nonRefundableCount = subscribers.filter((s) => s.eligibility === "non_refundable").length;
  const borderlineCount = subscribers.filter((s) => s.eligibility === "borderline").length;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Subscriptions & Refund Monitor</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Real-time subscriber usage, refund eligibility, and chargeback rebuttal tools
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="MRR" value="$0" sub="Billing coming soon" icon={<DollarSign className="w-5 h-5" />} color="#00E676" />
          <StatCard label="Paid Users" value={stats?.paidUsers ?? 0} icon={<Users className="w-5 h-5" />} color="#00D4FF" />
          <StatCard label="Non-Refundable" value={nonRefundableCount} sub="Usage threshold or video render" icon={<ShieldOff className="w-5 h-5" />} color="#ef4444" />
          <StatCard label="Borderline" value={borderlineCount} sub="Approaching threshold" icon={<AlertTriangle className="w-5 h-5" />} color="#f59e0b" />
        </div>

        {/* Admin alerts panel */}
        {alerts.length > 0 && (
          <div>
            <div className="text-xs text-white/30 font-semibold uppercase tracking-widest mb-3">
              Active Alerts ({alerts.length})
            </div>
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center gap-4 p-4 rounded-xl border"
                  style={{
                    border: alert.type === "chargeback_flagged" ? "1px solid rgba(239,68,68,0.3)" :
                            alert.type === "video_rendered" ? "1px solid rgba(168,139,250,0.3)" :
                            "1px solid rgba(245,158,11,0.3)",
                    background: alert.type === "chargeback_flagged" ? "rgba(239,68,68,0.05)" :
                                alert.type === "video_rendered" ? "rgba(168,139,250,0.05)" :
                                "rgba(245,158,11,0.05)",
                  }}
                >
                  <AlertTypeIcon type={alert.type} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">
                      {alert.userEmail ?? alert.userId}
                    </div>
                    <div className="text-white/40 text-xs">
                      {alert.type === "threshold_crossed" && `Used ${((alert.consumedPct ?? 0) * 100).toFixed(1)}% of AI ceiling · ${alert.planName} plan`}
                      {alert.type === "video_rendered" && "Video render initiated — subscription is fully earned"}
                      {alert.type === "chargeback_flagged" && "Chargeback flagged — rebuttal report generated"}
                    </div>
                  </div>
                  <div className="text-white/25 text-xs shrink-0">{fmtDate(alert.createdAt)}</div>
                  <button
                    onClick={() => dismissAlert.mutate(alert.id)}
                    className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/12 flex items-center justify-center transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5 text-white/40" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Subscriber usage table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-white/30 font-semibold uppercase tracking-widest">
              Subscriber Usage Monitor
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/25">
              <div className="w-0.5 h-3 bg-white/25 rounded" /> threshold cursor at 15%
            </div>
          </div>

          {subscribers.length === 0 ? (
            <div className="p-8 rounded-2xl border border-white/6 bg-white/2 text-center">
              <Users className="w-10 h-10 text-white/10 mx-auto mb-3" />
              <div className="text-white/30 text-sm">No subscribers yet. Paid plans launching soon.</div>
              <div className="text-white/20 text-xs mt-1">
                Trial users are tracked separately. This view shows active paid subscribers.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/8 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/6">
                    <th className="text-left px-5 py-3 text-[11px] text-white/30 font-semibold uppercase tracking-widest">Subscriber</th>
                    <th className="text-left px-4 py-3 text-[11px] text-white/30 font-semibold uppercase tracking-widest">Plan</th>
                    <th className="text-left px-4 py-3 text-[11px] text-white/30 font-semibold uppercase tracking-widest w-44">AI Usage</th>
                    <th className="text-left px-4 py-3 text-[11px] text-white/30 font-semibold uppercase tracking-widest">Status</th>
                    <th className="text-right px-5 py-3 text-[11px] text-white/30 font-semibold uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((sub) => {
                    const badge = BADGE_STYLE[sub.eligibility];
                    return (
                      <tr
                        key={sub.id}
                        className="border-b border-white/4 hover:bg-white/2 transition-colors cursor-pointer"
                        onClick={() => setSelectedUserId(sub.id)}
                      >
                        <td className="px-5 py-4">
                          <div className="text-white text-sm font-medium">{sub.email ?? sub.id}</div>
                          <div className="text-white/30 text-xs flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" /> Joined {fmtDate(sub.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: planColor(sub.plan) }} />
                            <span className="text-white/70 text-sm capitalize">{sub.plan}</span>
                          </div>
                          <div className="text-white/25 text-xs">${PLAN_PRICES[sub.plan] ?? "—"}/mo</div>
                        </td>
                        <td className="px-4 py-4 w-44">
                          <div className="mb-1.5">
                            <UsageBar pct={sub.consumedPct} eligibility={sub.eligibility} />
                          </div>
                          <div className="text-[10px] text-white/30">
                            {fmtUsd(sub.consumedUsd)} / {fmtUsd(sub.ceilingUsd)}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold w-fit"
                              style={{
                                background: `${badge.text}18`,
                                color: badge.text,
                                border: `1px solid ${badge.text}30`,
                              }}
                            >
                              {badge.label}
                            </span>
                            {sub.hasVideoRender && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-purple-400">
                                <Video className="w-2.5 h-2.5" /> Video rendered
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => window.open(`/api/admin/subscribers/${sub.id}/rebuttal-report`, "_blank")}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/3 hover:bg-white/8 text-white/50 hover:text-white text-xs transition-all"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              PDF
                            </button>
                            <button
                              onClick={() => setSelectedUserId(sub.id)}
                              className="flex items-center gap-1 text-white/30 hover:text-white text-xs transition-colors"
                            >
                              Details <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Threshold legend */}
        <div className="p-5 rounded-2xl border border-white/6 bg-white/2">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-white/20 shrink-0 mt-0.5" />
            <div>
              <div className="text-white/50 font-semibold text-sm mb-1">Refund Eligibility Rules</div>
              <div className="text-white/30 text-xs leading-relaxed space-y-1">
                <div>
                  <span className="text-[#00E676] font-medium">ELIGIBLE</span> — subscription is within the 3-day refund window and AI usage is below the internal threshold.
                </div>
                <div>
                  <span className="text-amber-400 font-medium">BORDERLINE</span> — approaching the usage threshold; monitor closely before approving any refund.
                </div>
                <div>
                  <span className="text-red-400 font-medium">NON-REFUNDABLE</span> — usage threshold exceeded, refund window expired, or video rendering initiated. Issue rebuttal report before responding to any chargeback.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Usage detail drawer */}
      {selectedUserId && (
        <UsageDrawer userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </AdminLayout>
  );
}
