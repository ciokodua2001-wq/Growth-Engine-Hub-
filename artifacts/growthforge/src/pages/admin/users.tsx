import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, MoreHorizontal, Shield, Ban, Trash2, RefreshCw, ChevronLeft, ChevronRight, UserCheck } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface User {
  id: string; email: string | null; role: string; plan: string;
  subscriptionStatus: string; suspended: boolean; onboardingComplete: boolean;
  createdAt: string; lastLoginAt: string | null;
}

const PLAN_COLORS: Record<string, string> = {
  trial: "#f59e0b", starter: "#00D4FF", growth: "#00E676", agency: "#a78bfa",
};
const ROLE_COLORS: Record<string, string> = {
  super_admin: "#00E676", admin: "#00D4FF", user: "rgba(255,255,255,0.4)",
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize"
      style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>
      {label}
    </span>
  );
}

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [activeUser, setActiveUser] = useState<string | null>(null);
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
    mutationFn: async ({ id, ...body }: { id: string; role?: string; plan?: string; suspended?: boolean }) => {
      const r = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/users"] }); setActiveUser(null); },
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/users"] }),
  });

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((window as unknown as { _st?: ReturnType<typeof setTimeout> })._st);
    (window as unknown as { _st?: ReturnType<typeof setTimeout> })._st = setTimeout(() => { setDebouncedSearch(v); setOffset(0); }, 300);
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
          <input value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
            style={{ background: "rgba(255,255,255,0.03)" }} />
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.01)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8">
                  {["Email","Role","Plan","Status","Signed Up","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-white/30 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/4">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 rounded animate-pulse bg-white/5 w-24" /></td>
                      ))}
                    </tr>
                  ))
                ) : (data?.users ?? []).map(user => (
                  <tr key={user.id} className="border-b border-white/4 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black shrink-0"
                          style={{ background: PLAN_COLORS[user.plan] ?? "#444" }}>
                          {(user.email ?? "?")[0].toUpperCase()}
                        </div>
                        <span className="text-white/80 font-medium">{user.email ?? <span className="text-white/30 italic">no email</span>}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge label={user.role} color={ROLE_COLORS[user.role] ?? "#888"} /></td>
                    <td className="px-4 py-3"><Badge label={user.plan} color={PLAN_COLORS[user.plan] ?? "#888"} /></td>
                    <td className="px-4 py-3">
                      {user.suspended
                        ? <Badge label="suspended" color="#ef4444" />
                        : <Badge label={user.subscriptionStatus} color={user.subscriptionStatus === "active" ? "#00E676" : "#f59e0b"} />}
                    </td>
                    <td className="px-4 py-3 text-white/30 text-xs whitespace-nowrap">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button onClick={() => setActiveUser(activeUser === user.id ? null : user.id)}
                          className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/8 transition-all">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {activeUser === user.id && (
                          <div className="absolute right-0 top-8 z-20 w-52 rounded-xl border border-white/10 shadow-2xl py-1"
                            style={{ background: "#0d1b2e" }}>
                            {[
                              { label: "Make Admin", icon: Shield, action: () => patchUser.mutate({ id: user.id, role: "admin" }) },
                              { label: user.suspended ? "Unsuspend" : "Suspend", icon: Ban, action: () => patchUser.mutate({ id: user.id, suspended: !user.suspended }) },
                              { label: "Reset to Trial", icon: RefreshCw, action: () => patchUser.mutate({ id: user.id, plan: "trial", subscriptionStatus: "trial" }) },
                              { label: "Grant Growth Plan", icon: UserCheck, action: () => patchUser.mutate({ id: user.id, plan: "growth", subscriptionStatus: "active" }) },
                              { label: "Delete User", icon: Trash2, action: () => { if (confirm("Delete this user permanently?")) deleteUser.mutate(user.id); }, danger: true },
                            ].map(({ label, icon: Icon, action, danger }) => (
                              <button key={label} onClick={action}
                                className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${danger ? "text-red-400" : "text-white/70"}`}>
                                <Icon className="w-4 h-4" />{label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && (data?.users ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-white/30">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/8">
              <span className="text-xs text-white/30">Page {currentPage} of {pages} · {total} total</span>
              <div className="flex items-center gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
                  className="p-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white disabled:opacity-30 transition-all">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)}
                  className="p-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white disabled:opacity-30 transition-all">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
