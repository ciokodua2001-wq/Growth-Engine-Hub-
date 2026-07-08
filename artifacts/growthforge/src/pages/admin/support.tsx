import { HeadphonesIcon, MessageSquare, Bug, Lightbulb, Star } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

const TICKET_TYPES = [
  { label: "Support Requests", icon: MessageSquare, count: 0, color: "#00D4FF" },
  { label: "Bug Reports", icon: Bug, count: 0, color: "#ef4444" },
  { label: "Feature Requests", icon: Lightbulb, count: 0, color: "#f59e0b" },
  { label: "User Feedback", icon: Star, count: 0, color: "#14F195" },
];

export default function AdminSupport() {
  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Support Center</h1>
          <p className="text-white/40 text-sm mt-0.5">Customer inquiries and feedback</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {TICKET_TYPES.map(({ label, icon: Icon, count, color }) => (
            <div key={label} className="p-5 rounded-2xl border border-white/8 hover:border-white/15 transition-all"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="text-3xl font-black text-white mb-1">{count}</div>
              <div className="text-xs text-white/40">{label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center rounded-2xl border border-white/8"
          style={{ background: "rgba(255,255,255,0.01)" }}>
          <HeadphonesIcon className="w-12 h-12 text-white/10" />
          <div>
            <div className="text-white/50 font-semibold mb-1">No open tickets</div>
            <div className="text-white/30 text-sm max-w-sm">
              Support tickets from the contact form at <span className="text-white/50">usegrowthforge.com/contact</span> will appear here.
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
