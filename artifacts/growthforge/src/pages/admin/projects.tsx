import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface Project {
  id: number; name: string; websiteUrl: string; description: string | null;
  status: string; industry: string | null; plan: string; createdAt: string; updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b", analyzing: "#00D4FF", active: "#00E676", completed: "#14F195", archived: "#888",
};

export default function AdminProjects() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const qc = useQueryClient();
  const LIMIT = 50;

  const { data, isLoading } = useQuery<{ projects: Project[]; total: number }>({
    queryKey: ["/api/admin/projects", debouncedSearch, offset],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const r = await fetch(`/api/admin/projects?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const deleteProject = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/projects/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/projects"] }),
  });

  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((window as unknown as { _pst?: ReturnType<typeof setTimeout> })._pst);
    (window as unknown as { _pst?: ReturnType<typeof setTimeout> })._pst = setTimeout(() => { setDebouncedSearch(v); setOffset(0); }, 300);
  };

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Projects</h1>
          <p className="text-white/40 text-sm mt-0.5">{total} total projects</p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name or URL…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
            style={{ background: "rgba(255,255,255,0.03)" }} />
        </div>

        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.01)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8">
                  {["Project","Website","Industry","Plan","Status","Created","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-white/30 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/4">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 rounded animate-pulse bg-white/5 w-20" /></td>
                      ))}
                    </tr>
                  ))
                ) : (data?.projects ?? []).map(p => (
                  <tr key={p.id} className="border-b border-white/4 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{p.name}</div>
                      {p.description && <div className="text-xs text-white/30 mt-0.5 max-w-[200px] truncate">{p.description}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[#00D4FF] hover:underline text-xs max-w-[140px] truncate">
                        {p.websiteUrl.replace(/^https?:\/\//, "")}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </td>
                    <td className="px-4 py-3 text-white/40 text-xs">{p.industry ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize"
                        style={{ background: "rgba(0,230,118,0.1)", color: "#00E676", border: "1px solid rgba(0,230,118,0.2)" }}>
                        {p.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize"
                        style={{ background: `${STATUS_COLORS[p.status] ?? "#888"}15`, color: STATUS_COLORS[p.status] ?? "#888", border: `1px solid ${STATUS_COLORS[p.status] ?? "#888"}25` }}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/30 text-xs whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <a href={`/projects/${p.id}/overview`}
                          className="p-1.5 rounded-lg text-white/30 hover:text-[#00D4FF] hover:bg-[#00D4FF]/10 transition-all">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        <button onClick={() => { if (confirm(`Delete project "${p.name}"?`)) deleteProject.mutate(p.id); }}
                          className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && (data?.projects ?? []).length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-white/30">No projects found</td></tr>
                )}
              </tbody>
            </table>
          </div>
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
