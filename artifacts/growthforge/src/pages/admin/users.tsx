import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, ChevronLeft, ChevronRight, Crown, Shield, Ban, Trash2,
  RefreshCw, UserCheck, X, Calendar, Clock, Code2,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface User {
  id: string;
  email: string | null;
  role: string;
  isOwner: boolean;
  plan: string;
  subscriptionStatus: string;
  suspended: boolean;
  onboardingComplete: boolean;
  canAccessDev: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

const PLAN_COLORS: Record<string, string> = {
  trial: "#f59e0b", starter: "#00D4FF", "get-going": "#00D4FF", growth: "#00E676", agency: "#a78bfa",
};

const PLANS = [
  { slug: "trial",     label: "Trial",     status: "trial"  },
  { slug: "starter",   label: "Starter",   status: "active" },
  { slug: "get-going", label: "Get-Going", status: "active" },
  { slug: "growth",    label: "Growth",    status: "active" },
  { slug: "agency",    label: "Agency",    status: "active" },
];

function RoleBadge({ role, isOwner }: { role: string; isOwner: boolean }) {
  if (isOwner || role === "super_admin") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold"
        style={{ background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b30" }}>
        👑 Owner
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
        style={{ background: "#00E67615", color: "#00E676", border: "1px solid #00E67625" }}>
        Admin
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
      User
    </span>
  );
}

function StatusBadge({ suspended, subscriptionStatus }: { suspended: boolean; subscriptionStatus: string }) {
  if (suspended) return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: "#ef444415", color: "#ef4444", border: "1px solid #ef444425" }}>Suspended</span>
  );
  const s = subscriptionStatus;
  if (s === "active" || s === "paid") return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: "#00E67615", color: "#00E676", border: "1px solid #00E67625" }}>Active</span>
  );
  if (s === "trial") return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b25" }}>Trial</span>
  );
  return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ background: "#6b728015", color: "#6b7280", border: "1px solid #6b728025" }}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const color = PLAN_COLORS[plan] ?? "#888";
  return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize"
      style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>
      {plan}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return <span className="text-white/20 italic">Never</span>;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function Avatar({ email, isOwner, plan }: { email: string | null; isOwner: boolean; plan: string }) {
  const color = isOwner ? "#f59e0b" : (PLAN_COLORS[plan] ?? "#444");
  const textColor = isOwner ? "#000" : "#000";
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{ background: color, color: textColor }}>
      {(email ?? "?")[0].toUpperCase()}
    </div>
  );
}

/* ─── Slide-out Drawer ──────────────────────────────────────── */

interface DrawerProps {
  user: User;
  onClose: () => void;
  onPatch: (body: { role?: string; plan?: string; subscriptionStatus?: string; suspended?: boolean; canAccessDev?: boolean }) => void;
  onDelete: () => void;
  isPatching: boolean;
  isDeleting: boolean;
}

function UserDrawer({ user, onClose, onPatch, onDelete, isPatching, isDeleting }: DrawerProps) {
  const isProtected = user.isOwner || user.role === "super_admin";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="absolute right-0 top-0 bottom-0 w-[500px] max-w-[96vw] flex flex-col shadow-2xl"
        style={{ background: "#091525", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-3">
            <Avatar email={user.email} isOwner={user.isOwner} plan={user.plan} />
            <div>
              <div className="font-semibold text-white text-sm truncate max-w-[280px]">
                {isProtected
                  ? <span className="text-amber-400/80 italic">Platform Owner</span>
                  : (user.email ?? <span className="text-white/30 italic">no email</span>)
                }
              </div>
              <div className="text-white/25 text-xs font-mono">
                {user.id.slice(0, 20)}…
              </div>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/8 transition-all shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Owner banner */}
        {isProtected && (
          <div className="mx-6 mt-4 rounded-xl px-4 py-3 flex items-center gap-3 shrink-0"
            style={{ background: "#f59e0b0d", border: "1px solid #f59e0b30" }}>
            <Crown className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <div className="text-amber-400 text-sm font-semibold">Platform Owner — Protected Account</div>
              <div className="text-amber-400/50 text-xs mt-0.5">
                This account cannot be suspended, deleted, or downgraded.
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Badges row */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Role", node: <RoleBadge role={user.role} isOwner={user.isOwner} /> },
              { label: "Plan", node: <PlanBadge plan={user.plan} /> },
              { label: "Status", node: <StatusBadge suspended={user.suspended} subscriptionStatus={user.subscriptionStatus} /> },
              {
                label: "Dev Access",
                node: user.canAccessDev ? (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
                    style={{ background: "#38bdf815", color: "#38bdf8", border: "1px solid #38bdf825" }}>
                    Approved
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
                    style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    Not approved
                  </span>
                ),
              },
            ].map(({ label, node }) => (
              <div key={label} className="rounded-xl p-3"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">{label}</div>
                {node}
              </div>
            ))}
          </div>

          {/* Dates */}
          <div className="rounded-xl p-4 space-y-3"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="w-3.5 h-3.5 text-white/25 shrink-0" />
              <span className="text-white/25 text-xs w-20 shrink-0">Joined</span>
              <span className="text-white/60 text-xs">{fmtDate(user.createdAt)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock className="w-3.5 h-3.5 text-white/25 shrink-0" />
              <span className="text-white/25 text-xs w-20 shrink-0">Last Login</span>
              <span className="text-white/60 text-xs">{fmtDate(user.lastLoginAt)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Shield className="w-3.5 h-3.5 text-white/25 shrink-0" />
              <span className="text-white/25 text-xs w-20 shrink-0">Onboarded</span>
              <span className={`text-xs font-medium ${user.onboardingComplete ? "text-emerald-400" : "text-white/25"}`}>
                {user.onboardingComplete ? "Complete" : "Incomplete"}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div>
            <div className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-3">
              {isProtected ? "View Actions Only" : "Account Actions"}
            </div>

            {isProtected ? (
              <p className="text-xs text-white/25 italic px-1">
                No modifications allowed on Platform Owner account.
              </p>
            ) : (
              <div className="space-y-1">
                {/* Role actions */}
                {user.role !== "admin" && user.role !== "super_admin" && (
                  <button
                    onClick={() => onPatch({ role: "admin" })}
                    disabled={isPatching}
                    className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-sky-400/80 hover:text-sky-400 hover:bg-sky-400/5 transition-all text-left disabled:opacity-40"
                  >
                    <Shield className="w-4 h-4 shrink-0" /> Promote to Admin
                  </button>
                )}
                {user.role === "admin" && (
                  <button
                    onClick={() => onPatch({ role: "user" })}
                    disabled={isPatching}
                    className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-white/50 hover:text-white/70 hover:bg-white/5 transition-all text-left disabled:opacity-40"
                  >
                    <Shield className="w-4 h-4 shrink-0 opacity-40" /> Demote to User
                  </button>
                )}

                {/* Suspension */}
                <button
                  onClick={() => onPatch({ suspended: !user.suspended })}
                  disabled={isPatching}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm transition-all text-left disabled:opacity-40
                    ${user.suspended
                      ? "text-emerald-400/80 hover:text-emerald-400 hover:bg-emerald-400/5"
                      : "text-amber-400/80 hover:text-amber-400 hover:bg-amber-400/5"}`}
                >
                  <Ban className="w-4 h-4 shrink-0" />
                  {user.suspended ? "Unsuspend Account" : "Suspend Account"}
                </button>

                {/* Dev environment access */}
                <button
                  onClick={() => onPatch({ canAccessDev: !user.canAccessDev })}
                  disabled={isPatching}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm transition-all text-left disabled:opacity-40
                    ${user.canAccessDev
                      ? "text-amber-400/80 hover:text-amber-400 hover:bg-amber-400/5"
                      : "text-sky-400/80 hover:text-sky-400 hover:bg-sky-400/5"}`}
                >
                  <Code2 className="w-4 h-4 shrink-0" />
                  {user.canAccessDev ? "Revoke dev.usegrowthforge.com access" : "Grant dev.usegrowthforge.com access"}
                </button>

                {/* Plan */}
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="px-4 py-2 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <UserCheck className="w-3.5 h-3.5 text-white/25 shrink-0" />
                    <span className="text-xs text-white/35 font-medium">Change Plan</span>
                    <span className="ml-auto text-[10px] text-white/20">current: {user.plan}</span>
                  </div>
                  <div className="p-1.5 flex flex-col gap-0.5">
                    {PLANS.map((p) => {
                      const color = PLAN_COLORS[p.slug] ?? "#888";
                      const isCurrent = user.plan === p.slug;
                      return (
                        <button
                          key={p.slug}
                          onClick={() => onPatch({ plan: p.slug, subscriptionStatus: p.status })}
                          disabled={isPatching || isCurrent}
                          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-xs transition-all text-left disabled:opacity-40"
                          style={isCurrent
                            ? { background: `${color}18`, color, border: `1px solid ${color}30`, cursor: "default" }
                            : { color: "rgba(255,255,255,0.5)", border: "1px solid transparent" }}
                          onMouseEnter={(e) => { if (!isCurrent && !isPatching) (e.currentTarget as HTMLButtonElement).style.background = `${color}10`; }}
                          onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.background = ""; }}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                          <span className="font-medium">{p.label}</span>
                          {isCurrent && <span className="ml-auto text-[10px] opacity-60">active</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Delete */}
                <div className="border-t border-white/6 mt-2 pt-2">
                  <button
                    onClick={() => {
                      if (confirm(`Permanently delete ${user.email ?? "this user"}? This cannot be undone.`)) {
                        onDelete();
                      }
                    }}
                    disabled={isDeleting}
                    className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-red-400/70 hover:text-red-400 hover:bg-red-400/5 transition-all text-left disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" /> Delete Account Permanently
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Main Page ─────────────────────────────────────────────── */

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const qc = useQueryClient();
  const LIMIT = 50;

  const { data, isLoading } = useQuery<{ users: User[]; total: number }>({
    queryKey: ["/api/admin/users", debouncedSearch, offset],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const r = await fetch(`/api/admin/users?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const patchUser = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; role?: string; plan?: string; subscriptionStatus?: string; suspended?: boolean; canAccessDev?: boolean }) => {
      const r = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to update user");
      }
      return r.json();
    },
    onSuccess: (updatedUser) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (selectedUser && selectedUser.id === updatedUser.id) {
        setSelectedUser(updatedUser);
      }
    },
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to delete user");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUser(null);
    },
  });

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((window as unknown as { _st?: ReturnType<typeof setTimeout> })._st);
    (window as unknown as { _st?: ReturnType<typeof setTimeout> })._st = setTimeout(() => {
      setDebouncedSearch(v); setOffset(0);
    }, 300);
  };

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Users</h1>
            <p className="text-white/40 text-sm mt-0.5">{total} total accounts</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
            style={{ background: "rgba(255,255,255,0.03)" }}
          />
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.01)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8">
                  {["User", "Role", "Plan", "Status", "Joined", "Last Login", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-white/30 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/4">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 rounded animate-pulse bg-white/5 w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                  : (data?.users ?? []).map(user => {
                    const isProtected = user.isOwner || user.role === "super_admin";
                    return (
                      <tr
                        key={user.id}
                        className="border-b border-white/4 hover:bg-white/[0.02] transition-colors cursor-pointer"
                        onClick={() => setSelectedUser(user)}
                      >
                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar email={user.email} isOwner={user.isOwner} plan={user.plan} />
                            <div className="min-w-0">
                              <div className="text-white/80 font-medium text-sm truncate max-w-[200px]">
                                {isProtected
                                  ? <span className="text-amber-400/70 italic">Platform Owner</span>
                                  : (user.email ?? <span className="text-white/25 italic">no email</span>)
                                }
                              </div>
                              {isProtected && (
                                <div className="text-amber-400/40 text-[10px] flex items-center gap-1 mt-0.5">
                                  <Crown className="w-2.5 h-2.5" /> Protected account
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* Role */}
                        <td className="px-4 py-3">
                          <RoleBadge role={user.role} isOwner={user.isOwner} />
                        </td>
                        {/* Plan */}
                        <td className="px-4 py-3">
                          <PlanBadge plan={user.plan} />
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <StatusBadge suspended={user.suspended} subscriptionStatus={user.subscriptionStatus} />
                        </td>
                        {/* Joined */}
                        <td className="px-4 py-3 text-white/30 text-xs whitespace-nowrap">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        {/* Last Login */}
                        <td className="px-4 py-3 text-white/30 text-xs whitespace-nowrap">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : <span className="text-white/15">—</span>}
                        </td>
                        {/* View button */}
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setSelectedUser(user)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white transition-colors"
                            style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })
                }
                {!isLoading && (data?.users ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-white/30">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/8">
              <span className="text-xs text-white/30">Page {currentPage} of {pages} · {total} total</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
                  className="p-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white disabled:opacity-30 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={offset + LIMIT >= total}
                  onClick={() => setOffset(o => o + LIMIT)}
                  className="p-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white disabled:opacity-30 transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Slide-out drawer */}
      {selectedUser && (
        <UserDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onPatch={(body) => patchUser.mutate({ id: selectedUser.id, ...body })}
          onDelete={() => deleteUser.mutate(selectedUser.id)}
          isPatching={patchUser.isPending}
          isDeleting={deleteUser.isPending}
        />
      )}
    </AdminLayout>
  );
}
