import { useQuery } from "@tanstack/react-query";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import AdminLayout from "@/components/admin/admin-layout";

interface AuditLog {
  id: number; adminId: string; adminEmail: string | null; action: string;
  targetType: string | null; targetId: string | null; details: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  user_updated: "#00D4FF", user_deleted: "#ef4444", project_deleted: "#ef4444",
  feature_enabled: "#00E676", feature_disabled: "#f59e0b",
  announcement_created: "#14F195", announcement_updated: "#00D4FF", announcement_deleted: "#ef4444",
  user_promoted: "#a78bfa",
};

export default function AdminAudit() {
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number }>({
    queryKey: ["/api/admin/audit-logs", offset],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      const r = await fetch(`/api/admin/audit-logs?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Audit Log</h1>
          <p className="text-white/40 text-sm mt-0.5">Every admin action is recorded here</p>
        </div>

        <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.01)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8">
                  {["Action","Admin","Target","Details","Time"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-white/30 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/4">
                      {Array.from({ length: 5 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 rounded animate-pulse bg-white/5 w-28" /></td>)}
                    </tr>
                  ))
                ) : (data?.logs ?? []).map(log => (
                  <tr key={log.id} className="border-b border-white/4 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-md text-xs font-semibold"
                        style={{
                          background: `${ACTION_COLORS[log.action] ?? "#888"}15`,
                          color: ACTION_COLORS[log.action] ?? "rgba(255,255,255,0.5)",
                        }}>
                        {log.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50 text-xs">{log.adminEmail ?? log.adminId.slice(0, 12) + "…"}</td>
                    <td className="px-4 py-3 text-white/30 text-xs">
                      {log.targetType && <span className="capitalize">{log.targetType}</span>}
                      {log.targetId && <span className="ml-1 text-white/20">#{log.targetId}</span>}
                      {!log.targetType && "—"}
                    </td>
                    <td className="px-4 py-3 text-white/30 text-xs max-w-[200px] truncate">
                      {log.details ? JSON.stringify(log.details).slice(0, 60) : "—"}
                    </td>
                    <td className="px-4 py-3 text-white/30 text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {!isLoading && (data?.logs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Shield className="w-10 h-10 text-white/10" />
                        <div className="text-white/30 text-sm">No audit events recorded yet</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/8">
              <span className="text-xs text-white/30">Page {currentPage} of {pages} · {total} total</span>
              <div className="flex items-center gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
                  className="p-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)}
                  className="p-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white disabled:opacity-30">
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
