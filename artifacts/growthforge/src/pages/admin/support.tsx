import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HeadphonesIcon, MessageSquare, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Send, ArrowUpCircle, Loader2, RefreshCw,
  Clock, User, Tag,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupportTicket {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  category: string;
  status: "open" | "ai_responded" | "escalated" | "resolved";
  aiResponse: string | null;
  adminReply: string | null;
  adminRepliedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}

interface TicketCounts {
  total: number;
  open: number;
  ai_responded: number;
  escalated: number;
  resolved: number;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  ai_responded: "AI Replied",
  escalated: "Escalated",
  resolved: "Resolved",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  ai_responded: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  escalated: "bg-red-500/15 text-red-400 border-red-500/25",
  resolved: "bg-white/10 text-white/50 border-white/15",
};

const CATEGORY_COLORS: Record<string, string> = {
  technical: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  billing: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  sales: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  demo: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  partnership: "bg-pink-500/15 text-pink-400 border-pink-500/25",
  feedback: "bg-lime-500/15 text-lime-400 border-lime-500/25",
  other: "bg-white/10 text-white/50 border-white/15",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Ticket Row ─────────────────────────────────────────────────────────────────

function TicketRow({ ticket }: { ticket: SupportTicket }) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState("");
  const queryClient = useQueryClient();

  const patchMutation = useMutation({
    mutationFn: (body: { adminReply?: string; status?: string }) =>
      apiFetch<SupportTicket>(`/api/owner/support/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setReply("");
    },
  });

  const escalateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>(`/api/owner/support/tickets/${ticket.id}/escalate`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support-tickets"] }),
  });

  const handleSendReply = () => {
    if (!reply.trim()) return;
    patchMutation.mutate({ adminReply: reply.trim() });
  };

  const handleResolve = () => patchMutation.mutate({ status: "resolved" });
  const handleEscalate = () => escalateMutation.mutate();

  const statusCls = STATUS_COLORS[ticket.status] ?? STATUS_COLORS["other"]!;
  const categoryCls = CATEGORY_COLORS[ticket.category] ?? CATEGORY_COLORS["other"]!;

  return (
    <div className="border border-white/8 rounded-xl overflow-hidden transition-all" style={{ background: "rgba(255,255,255,0.015)" }}>
      {/* Row header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-white/60">{ticket.name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-white truncate">{ticket.name}</span>
            <span className="text-white/30 text-xs">·</span>
            <span className="text-xs text-white/40 truncate">{ticket.email}</span>
          </div>
          <p className="text-xs text-white/60 truncate">{ticket.subject}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${categoryCls}`}>
            {ticket.category}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusCls}`}>
            {STATUS_LABEL[ticket.status] ?? ticket.status}
          </span>
          <span className="text-[10px] text-white/30 hidden sm:block">{timeAgo(ticket.createdAt)}</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-white/30" /> : <ChevronDown className="h-3.5 w-3.5 text-white/30" />}
        </div>
      </button>

      {/* Expanded thread */}
      {expanded && (
        <div className="border-t border-white/8 px-5 pb-5 pt-4 space-y-4">
          {/* Customer message */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <User className="h-3 w-3 text-white/30" />
              <span className="text-[11px] text-white/40 font-semibold uppercase tracking-wide">Customer</span>
              <span className="text-[10px] text-white/25 ml-auto">{new Date(ticket.createdAt).toLocaleString()}</span>
            </div>
            <div className="rounded-xl p-4 text-sm text-white/75 leading-relaxed whitespace-pre-wrap"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {ticket.message}
            </div>
          </div>

          {/* AI response */}
          {ticket.aiResponse && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[10px]">⚡</span>
                <span className="text-[11px] text-[#00E676]/70 font-semibold uppercase tracking-wide">AI Agent replied</span>
              </div>
              <div className="rounded-xl p-4 text-sm text-[#d1fae5]/80 leading-relaxed whitespace-pre-wrap"
                style={{ background: "rgba(0,230,118,0.05)", border: "1px solid rgba(0,230,118,0.15)" }}>
                {ticket.aiResponse}
              </div>
            </div>
          )}

          {/* Admin reply (if exists) */}
          {ticket.adminReply && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[10px]">👤</span>
                <span className="text-[11px] text-purple-400/70 font-semibold uppercase tracking-wide">You replied</span>
                {ticket.adminRepliedAt && (
                  <span className="text-[10px] text-white/25 ml-auto">{new Date(ticket.adminRepliedAt).toLocaleString()}</span>
                )}
              </div>
              <div className="rounded-xl p-4 text-sm text-purple-200/80 leading-relaxed whitespace-pre-wrap"
                style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}>
                {ticket.adminReply}
              </div>
            </div>
          )}

          {/* Reply input (shown unless resolved) */}
          {ticket.status !== "resolved" && (
            <div className="space-y-3 pt-1">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                placeholder="Type your reply… it will be sent to the customer by email"
                rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm text-white/80 placeholder:text-white/25 focus:outline-none resize-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSendReply}
                  disabled={!reply.trim() || patchMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#00E676] text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#00ff88] transition-colors"
                >
                  {patchMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Send & Resolve
                </button>

                {ticket.status !== "escalated" && (
                  <button
                    onClick={handleEscalate}
                    disabled={escalateMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                  >
                    {escalateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpCircle className="h-3 w-3" />}
                    Escalate
                  </button>
                )}

                <button
                  onClick={handleResolve}
                  disabled={patchMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-white/15 text-white/50 hover:text-white hover:border-white/30 disabled:opacity-50 transition-colors ml-auto"
                >
                  <CheckCircle2 className="h-3 w-3" /> Mark Resolved
                </button>
              </div>
              {patchMutation.isError && (
                <p className="text-xs text-red-400">Failed to update ticket. Please try again.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "escalated", label: "Escalated" },
  { value: "ai_responded", label: "AI Replied" },
  { value: "resolved", label: "Resolved" },
];

export default function AdminSupport() {
  const [statusFilter, setStatusFilter] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["support-tickets", statusFilter],
    queryFn: () =>
      apiFetch<{ tickets: SupportTicket[]; counts: TicketCounts }>(
        `/api/owner/support/tickets${statusFilter ? `?status=${statusFilter}` : ""}`,
      ),
    refetchInterval: 30_000,
  });

  const counts = data?.counts;
  const tickets = data?.tickets ?? [];

  const STAT_CARDS = [
    { label: "Open", count: counts?.open ?? 0, icon: MessageSquare, color: "#00D4FF" },
    { label: "Escalated", count: counts?.escalated ?? 0, icon: AlertTriangle, color: "#ef4444" },
    { label: "AI Replied", count: counts?.ai_responded ?? 0, icon: HeadphonesIcon, color: "#00E676" },
    { label: "Resolved", count: counts?.resolved ?? 0, icon: CheckCircle2, color: "#9ca3af" },
  ];

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Support Center</h1>
            <p className="text-white/40 text-sm mt-0.5">AI-first support — escalations land here</p>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["support-tickets"] })}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/25 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STAT_CARDS.map(({ label, icon: Icon, count, color }) => (
            <div key={label} className="p-5 rounded-2xl border border-white/8 hover:border-white/15 transition-all"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="text-3xl font-black text-white mb-1">{isLoading ? "—" : count}</div>
              <div className="text-xs text-white/40">{label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === f.value
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white hover:bg-white/5"
              }`}
            >
              {f.label}
              {f.value === "escalated" && (counts?.escalated ?? 0) > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                  {counts!.escalated}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Ticket list */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-white/30" />
            <span className="text-white/30 text-sm">Loading tickets…</span>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center rounded-2xl border border-red-500/20"
            style={{ background: "rgba(239,68,68,0.04)" }}>
            <AlertTriangle className="w-8 h-8 text-red-400/50" />
            <p className="text-white/40 text-sm">Failed to load tickets. Check your connection and refresh.</p>
          </div>
        )}

        {!isLoading && !isError && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center rounded-2xl border border-white/8"
            style={{ background: "rgba(255,255,255,0.01)" }}>
            <HeadphonesIcon className="w-12 h-12 text-white/10" />
            <div>
              <div className="text-white/50 font-semibold mb-1">
                {statusFilter ? `No ${STATUS_LABEL[statusFilter] ?? statusFilter} tickets` : "No open tickets"}
              </div>
              <div className="text-white/30 text-sm max-w-sm">
                Tickets submitted at <span className="text-white/50">usegrowthforge.com/contact</span> will appear here.
                The AI agent replies automatically — only escalations need your attention.
              </div>
            </div>
          </div>
        )}

        {!isLoading && !isError && tickets.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-white/30 px-1">
              <Tag className="h-3 w-3" />
              <span>{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</span>
              <Clock className="h-3 w-3 ml-2" />
              <span>Click a row to view full thread and reply</span>
            </div>
            {tickets.map(t => <TicketRow key={t.id} ticket={t} />)}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
