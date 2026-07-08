import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Megaphone, Trash2, ToggleRight, ToggleLeft, X } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface Announcement {
  id: number; title: string; message: string; type: string;
  active: boolean; createdBy: string | null; createdAt: string; expiresAt: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  info: "#00D4FF", warning: "#f59e0b", success: "#00E676", maintenance: "#a78bfa",
};

function AnnouncementModal({ onClose, onSave }: { onClose: () => void; onSave: (d: { title: string; message: string; type: string }) => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("info");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 shadow-2xl p-6 space-y-5"
        style={{ background: "#0d1b2e" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">New Announcement</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-white/40 font-medium block mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. New Feature Released"
              className="w-full px-3 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 bg-white/3" />
          </div>
          <div>
            <label className="text-xs text-white/40 font-medium block mb-1.5">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              rows={3} placeholder="Announcement details…"
              className="w-full px-3 py-2.5 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 bg-white/3 resize-none" />
          </div>
          <div>
            <label className="text-xs text-white/40 font-medium block mb-1.5">Type</label>
            <div className="flex gap-2 flex-wrap">
              {["info","success","warning","maintenance"].map(t => (
                <button key={t} onClick={() => setType(t)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all border"
                  style={type === t
                    ? { background: `${TYPE_COLORS[t]}20`, color: TYPE_COLORS[t], border: `1px solid ${TYPE_COLORS[t]}40` }
                    : { background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-white/50 hover:text-white border border-white/8 transition-all">Cancel</button>
          <button onClick={() => { if (title && message) { onSave({ title, message, type }); onClose(); } }}
            disabled={!title || !message}
            className="px-5 py-2 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
            style={{ background: "#00E676" }}>
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminAnnouncements() {
  const [showModal, setShowModal] = useState(false);
  const qc = useQueryClient();

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/admin/announcements"],
    queryFn: async () => {
      const r = await fetch("/api/admin/announcements", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const create = useMutation({
    mutationFn: async (body: { title: string; message: string; type: string }) => {
      const r = await fetch("/api/admin/announcements", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/announcements"] }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const r = await fetch(`/api/admin/announcements/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/announcements"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/announcements/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/announcements"] }),
  });

  return (
    <AdminLayout>
      {showModal && <AnnouncementModal onClose={() => setShowModal(false)} onSave={d => create.mutate(d)} />}
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Announcements</h1>
            <p className="text-white/40 text-sm mt-0.5">{announcements.filter(a => a.active).length} active banners</p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02]"
            style={{ background: "#00E676" }}>
            <Plus className="w-4 h-4" /> New Announcement
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl border border-white/8 animate-pulse bg-white/3" />)}</div>
        ) : announcements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <Megaphone className="w-12 h-12 text-white/10" />
            <div>
              <div className="text-white/50 font-semibold mb-1">No announcements yet</div>
              <div className="text-white/30 text-sm">Create banners to notify users of updates, maintenance, or new features.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {announcements.map(a => (
              <div key={a.id} className="flex items-start gap-4 p-5 rounded-2xl border transition-all"
                style={{
                  background: a.active ? `${TYPE_COLORS[a.type] ?? "#888"}05` : "rgba(255,255,255,0.01)",
                  border: a.active ? `1px solid ${TYPE_COLORS[a.type] ?? "#888"}20` : "1px solid rgba(255,255,255,0.06)",
                }}>
                <div className="w-2 h-2 rounded-full mt-2 shrink-0"
                  style={{ background: a.active ? (TYPE_COLORS[a.type] ?? "#888") : "rgba(255,255,255,0.1)" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-white font-semibold text-sm">{a.title}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize"
                      style={{ background: `${TYPE_COLORS[a.type] ?? "#888"}15`, color: TYPE_COLORS[a.type] ?? "#888" }}>
                      {a.type}
                    </span>
                    {!a.active && <span className="text-[10px] text-white/20 font-semibold">INACTIVE</span>}
                  </div>
                  <p className="text-white/50 text-sm leading-relaxed">{a.message}</p>
                  <div className="text-[10px] text-white/20 mt-2">{new Date(a.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggle.mutate({ id: a.id, active: !a.active })}
                    className="transition-all hover:scale-105">
                    {a.active
                      ? <ToggleRight className="w-7 h-7" style={{ color: "#00E676" }} />
                      : <ToggleLeft className="w-7 h-7 text-white/20" />}
                  </button>
                  <button onClick={() => { if (confirm("Delete this announcement?")) remove.mutate(a.id); }}
                    className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
