import { Activity } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

export default function AdminActivity() {
  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Customer Activity</h1>
          <p className="text-white/40 text-sm mt-0.5">User signups, logins, and platform actions</p>
        </div>

        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center rounded-2xl border border-white/8"
          style={{ background: "rgba(255,255,255,0.01)" }}>
          <Activity className="w-12 h-12 text-white/10" />
          <div>
            <div className="text-white/50 font-semibold mb-1">Activity Tracking Not Yet Active</div>
            <div className="text-white/30 text-sm max-w-sm">
              User activity events (signups, logins, project creation, AI usage, subscription changes) will be streamed here once event tracking is enabled.
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
