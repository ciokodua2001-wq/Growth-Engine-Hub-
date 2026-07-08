import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ToggleLeft, ToggleRight, RefreshCw } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface FeatureFlag {
  id: number; name: string; label: string; description: string | null;
  enabled: boolean; updatedBy: string | null; updatedAt: string;
}

export default function AdminFeatures() {
  const qc = useQueryClient();

  const { data: flags = [], isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags"],
    queryFn: async () => {
      const r = await fetch("/api/admin/feature-flags", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const r = await fetch(`/api/admin/feature-flags/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }),
  });

  const seedFlags = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/feature-flags/seed", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }),
  });

  const enabledCount = flags.filter(f => f.enabled).length;

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Feature Flags</h1>
            <p className="text-white/40 text-sm mt-0.5">{enabledCount} of {flags.length} features enabled</p>
          </div>
          {flags.length === 0 && !isLoading && (
            <button onClick={() => seedFlags.mutate()}
              disabled={seedFlags.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all"
              style={{ background: "#00E676" }}>
              <RefreshCw className={`w-4 h-4 ${seedFlags.isPending ? "animate-spin" : ""}`} />
              Seed Default Flags
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl border border-white/8 animate-pulse bg-white/3" />
            ))}
          </div>
        ) : flags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <ToggleLeft className="w-12 h-12 text-white/10" />
            <div>
              <div className="text-white/50 font-semibold mb-1">No feature flags yet</div>
              <div className="text-white/30 text-sm">Click "Seed Default Flags" to set up the platform features.</div>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {flags.map(flag => (
              <div key={flag.id} className="flex items-start justify-between gap-4 p-5 rounded-2xl border transition-all"
                style={{
                  background: flag.enabled ? "rgba(0,230,118,0.03)" : "rgba(255,255,255,0.01)",
                  border: flag.enabled ? "1px solid rgba(0,230,118,0.15)" : "1px solid rgba(255,255,255,0.06)",
                }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-white text-sm">{flag.label}</span>
                    <span className="text-[10px] text-white/20 font-mono">{flag.name}</span>
                  </div>
                  {flag.description && <p className="text-white/40 text-xs leading-relaxed">{flag.description}</p>}
                  <div className="text-[10px] text-white/20 mt-2">
                    Last updated {new Date(flag.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => toggle.mutate({ id: flag.id, enabled: !flag.enabled })}
                  disabled={toggle.isPending}
                  className="shrink-0 transition-all hover:scale-105">
                  {flag.enabled
                    ? <ToggleRight className="w-8 h-8" style={{ color: "#00E676" }} />
                    : <ToggleLeft className="w-8 h-8 text-white/20" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
