import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseZap, Hash, Clock, Eye, Download,
  ShieldCheck, TestTube, Search, ChevronRight, X, FileText,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

/* ── Types ──────────────────────────────────────────────────── */

interface IntegrityUser {
  userId: string;
  email: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  isTestAccount: boolean;
  totalAssets: number;
  firstGenerated: string | null;
  lastGenerated: string | null;
  lastAccessed: string | null;
}

interface AssetRow {
  id: number;
  userId: string;
  projectId: number | null;
  contentType: string;
  contentId: string;
  contentHash: string;
  summary: string | null;
  generatedAt: string;
  firstAccessedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  isTestAccount: boolean;
}

interface UserDetail {
  user: {
    email: string | null;
    plan: string | null;
    subscriptionStatus: string | null;
    isOwner: boolean;
    isTestAccount: boolean;
  } | null;
  assets: AssetRow[];
}

/* ── Helpers ────────────────────────────────────────────────── */

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDatetime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const TYPE_LABEL: Record<string, string> = {
  business_analysis: "Business Analysis",
  personas: "Personas",
  marketing_strategy: "Marketing Strategy",
  competitors: "Competitors",
  competitor_report: "Competitor Report",
  social_posts: "Social Posts",
  email_campaign: "Email Campaign",
  video_blueprints: "Video Blueprint",
  ad_creatives: "Ad Creatives",
  content: "Content",
  agent_message: "Forge AI",
  report: "Report",
};

const TYPE_COLOR: Record<string, string> = {
  video_blueprints: "#00D4FF",
  business_analysis: "#00E676",
  marketing_strategy: "#14F195",
  competitors: "#FFB800",
  competitor_report: "#FF7C00",
  social_posts: "#A78BFA",
  email_campaign: "#F472B6",
  personas: "#34D399",
  ad_creatives: "#FB923C",
};

/* ── Drawer ─────────────────────────────────────────────────── */

function UserDrawer({ userId, onClose, onTestAccountChanged }: { userId: string; onClose: () => void; onTestAccountChanged: () => void }) {
  const { data, isLoading, refetch } = useQuery<UserDetail>({
    queryKey: ["/api/admin/integrity", userId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/integrity/${userId}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const [search, setSearch] = useState("");
  const [togglingTest, setTogglingTest] = useState(false);

  async function handleToggleTest() {
    const current = data?.user?.isTestAccount ?? false;
    const next = !current;
    const label = next ? "test account" : "live subscriber";
    if (!confirm(`Mark this account as a ${label}? This will ${next ? "exclude it from" : "include it in"} all evidence PDFs and retroactively update all their integrity log records.`)) return;
    setTogglingTest(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/test-account`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTestAccount: next }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refetch();
      onTestAccountChanged();
    } catch (err) {
      alert(`Failed to update: ${err}`);
    } finally {
      setTogglingTest(false);
    }
  }

  const filtered = (data?.assets ?? []).filter((a) => {
    const q = search.toLowerCase();
    return (
      !q ||
      a.contentType.includes(q) ||
      (a.summary ?? "").toLowerCase().includes(q) ||
      a.contentHash.startsWith(q)
    );
  });

  function handleDownloadPdf() {
    window.open(`/api/admin/integrity/${userId}/evidence-pdf`, "_blank");
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative ml-auto h-full w-full max-w-2xl flex flex-col border-l border-white/8 overflow-hidden"
        style={{ background: "#06101e" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/8 shrink-0">
          <div>
            <p className="text-[#00E676] text-xs font-semibold uppercase tracking-widest mb-1">Content Integrity</p>
            <h2 className="text-white font-bold text-lg truncate max-w-xs">
              {data?.user?.email ?? userId}
            </h2>
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-white/10 text-white/50">
                {data?.user?.plan ?? "—"}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-white/10 text-white/50">
                {data?.user?.subscriptionStatus ?? "—"}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "#00E676/20", color: "#00E676", border: "1px solid #00E67630" }}>
                {(data?.assets ?? []).length} assets
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={handleToggleTest}
              disabled={togglingTest || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50"
              style={
                data?.user?.isTestAccount
                  ? { background: "#ffffff10", borderColor: "#ffffff20", color: "#ffffff70" }
                  : { background: "#FFB80015", borderColor: "#FFB80040", color: "#FFB800" }
              }
              title={data?.user?.isTestAccount ? "Unmark as test account" : "Mark as test account"}
            >
              <TestTube className="w-3 h-3" />
              {data?.user?.isTestAccount ? "Unmark test" : "Mark as test"}
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={data?.user?.isTestAccount}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#00E676", color: "#000" }}
              title={data?.user?.isTestAccount ? "Test accounts are excluded from evidence PDFs" : "Download evidence PDF"}
            >
              <Download className="w-3 h-3" />
              Evidence PDF
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-white/5 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by type, summary, or hash…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/8 text-white text-xs placeholder-white/30 focus:outline-none focus:border-white/20"
            />
          </div>
        </div>

        {/* Asset list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-white/30 text-sm">Loading assets…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="flex items-center justify-center py-16 text-white/30 text-sm">No assets found</div>
          )}
          {filtered.map((asset) => (
            <div
              key={asset.id}
              className="rounded-xl border border-white/6 p-3.5 space-y-2"
              style={{ background: "#0a1628" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: `${TYPE_COLOR[asset.contentType] ?? "#888"}22`, color: TYPE_COLOR[asset.contentType] ?? "#888", border: `1px solid ${TYPE_COLOR[asset.contentType] ?? "#888"}40` }}
                  >
                    {TYPE_LABEL[asset.contentType] ?? asset.contentType}
                  </span>
                  <span className="text-white text-xs font-medium truncate">{asset.summary ?? `#${asset.contentId}`}</span>
                </div>
                <span className="shrink-0 text-white/30 text-[10px]">#{asset.contentId}</span>
              </div>

              <div className="flex items-center gap-1 font-mono text-[10px] text-white/40 bg-white/4 rounded px-2 py-1 overflow-hidden">
                <Hash className="w-2.5 h-2.5 shrink-0 text-white/30" />
                <span className="truncate">{asset.contentHash}</span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-white/40">
                <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Generated {fmtDatetime(asset.generatedAt)}</span>
                {asset.firstAccessedAt && (
                  <span className="flex items-center gap-1"><Eye className="w-2.5 h-2.5" /> First viewed {fmtDatetime(asset.firstAccessedAt)}</span>
                )}
                {asset.accessCount > 0 && (
                  <span className="flex items-center gap-1 text-[#00E676]/60">
                    <Eye className="w-2.5 h-2.5" /> {asset.accessCount}× accessed
                  </span>
                )}
                {!asset.firstAccessedAt && (
                  <span className="text-white/20 italic">Not yet accessed</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */

export default function IntegrityPage() {
  const queryClient = useQueryClient();
  const [searchQ, setSearchQ] = useState("");
  const [showTest, setShowTest] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<IntegrityUser[]>({
    queryKey: ["/api/admin/integrity"],
    queryFn: async () => {
      const r = await fetch("/api/admin/integrity", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const filtered = rows.filter((u) => {
    if (!showTest && u.isTestAccount) return false;
    const q = searchQ.toLowerCase();
    return !q || (u.email ?? "").toLowerCase().includes(q) || u.userId.includes(q);
  });

  const liveUsers = rows.filter((u) => !u.isTestAccount);
  const totalAssets = liveUsers.reduce((s, u) => s + (u.totalAssets ?? 0), 0);
  const accessedUsers = liveUsers.filter((u) => u.lastAccessed).length;

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <DatabaseZap className="w-5 h-5" style={{ color: "#00E676" }} />
              <h1 className="text-xl font-bold text-white">Data Integrity Monitor</h1>
            </div>
            <p className="text-white/40 text-sm">Cryptographic proof of every AI-generated asset delivered to subscribers. Used for dispute resolution and legal evidence.</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Live Users Tracked", value: liveUsers.length, icon: ShieldCheck, color: "#00E676" },
            { label: "Total Assets Logged", value: totalAssets, icon: FileText, color: "#00D4FF" },
            { label: "Users Who Accessed", value: accessedUsers, icon: Eye, color: "#14F195" },
            { label: "Test Accounts", value: rows.filter((u) => u.isTestAccount).length, icon: TestTube, color: "#888" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-white/6 p-4" style={{ background: "#0a1628" }}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4" style={{ color }} />
                <span className="text-white/50 text-xs">{label}</span>
              </div>
              <p className="text-2xl font-black text-white">{value}</p>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search by email or user ID…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/8 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/20"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-white/40 cursor-pointer select-none">
            <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} className="accent-[#00E676]" />
            Show test accounts
          </label>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/6 overflow-hidden" style={{ background: "#0a1628" }}>
          <div className="grid grid-cols-[1fr_80px_100px_120px_120px_44px] gap-0 border-b border-white/8 px-5 py-3">
            {["User", "Plan", "Assets", "First Generated", "Last Generated", ""].map((h) => (
              <div key={h} className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">{h}</div>
            ))}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-16 text-white/30 text-sm">Loading…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="flex items-center justify-center py-16 text-white/30 text-sm">
              {rows.length === 0 ? "No assets logged yet — generate content to start tracking." : "No users match your search."}
            </div>
          )}

          {filtered.map((u) => (
            <div
              key={u.userId}
              className="grid grid-cols-[1fr_80px_100px_120px_120px_44px] gap-0 px-5 py-3.5 border-b border-white/4 hover:bg-white/3 transition-colors cursor-pointer"
              onClick={() => setSelectedUser(u.userId)}
            >
              <div className="flex items-center gap-2 min-w-0 pr-3">
                {u.isTestAccount && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-white/10 text-white/40">TEST</span>
                )}
                <span className="text-white text-sm font-medium truncate">{u.email ?? u.userId}</span>
              </div>
              <div className="flex items-center">
                <span className="text-white/50 text-xs capitalize">{u.plan ?? "—"}</span>
              </div>
              <div className="flex items-center">
                <span className="text-white font-semibold text-sm">{u.totalAssets}</span>
              </div>
              <div className="flex items-center">
                <span className="text-white/40 text-xs">{fmtDate(u.firstGenerated)}</span>
              </div>
              <div className="flex items-center">
                <span className="text-white/40 text-xs">{fmtDate(u.lastGenerated)}</span>
              </div>
              <div className="flex items-center justify-center">
                <ChevronRight className="w-4 h-4 text-white/30" />
              </div>
            </div>
          ))}
        </div>

        <p className="text-white/20 text-xs text-center">
          Records are immutable — assets are logged at generation time and cannot be deleted. Soft-deleted projects remain in the integrity log.
        </p>
      </div>

      {selectedUser && (
        <UserDrawer
          userId={selectedUser}
          onClose={() => setSelectedUser(null)}
          onTestAccountChanged={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/integrity"] })}
        />
      )}
    </AdminLayout>
  );
}
