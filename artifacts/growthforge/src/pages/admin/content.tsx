import { FileText, Download, Trash2 } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

const CATEGORIES = [
  { label: "Business Analyses", count: 0, color: "#00E676" },
  { label: "Marketing Strategies", count: 0, color: "#00D4FF" },
  { label: "Competitor Reports", count: 0, color: "#14F195" },
  { label: "Email Campaigns", count: 0, color: "#a78bfa" },
  { label: "Social Content", count: 0, color: "#f59e0b" },
  { label: "Video Blueprints", count: 0, color: "#00E676" },
];

export default function AdminContent() {
  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Content Management</h1>
          <p className="text-white/40 text-sm mt-0.5">All AI-generated assets across the platform</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORIES.map(({ label, count, color }) => (
            <div key={label} className="group p-5 rounded-2xl border border-white/8 hover:border-white/15 transition-all"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
                  <FileText className="w-4 h-4" style={{ color }} />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1.5 rounded-lg text-white/20 hover:text-[#00D4FF] hover:bg-[#00D4FF]/10 transition-all">
                    <Download className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="text-2xl font-black text-white mb-1">{count}</div>
              <div className="text-sm font-medium text-white/60">{label}</div>
            </div>
          ))}
        </div>

        <div className="p-5 rounded-2xl border border-blue-500/20 bg-blue-500/5">
          <div className="text-blue-400 font-semibold text-sm mb-1">Content Library</div>
          <div className="text-white/40 text-sm">Generated content appears here as users create analyses, campaigns, and strategies through their projects.</div>
        </div>
      </div>
    </AdminLayout>
  );
}
