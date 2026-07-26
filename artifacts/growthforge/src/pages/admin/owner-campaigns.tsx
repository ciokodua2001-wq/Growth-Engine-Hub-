import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import AdminLayout from "@/components/admin/admin-layout";
import {
  Mail, Plus, Trash2, Send, Eye, Loader2, X, Users, Megaphone,
  BarChart2, Clock, CheckCircle, FileText,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Campaign {
  id: number;
  name: string;
  subject: string;
  body: string;
  targetType: string;
  segmentId: number | null;
  filterJson: Record<string, string> | null;
  status: string;
  sentAt: string | null;
  recipientCount: number | null;
  openRate: string | null;
  clickRate: string | null;
  bounceRate: string | null;
  unsubscribeCount: number;
  createdAt: string;
}

function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["owner-campaigns"],
    queryFn: () => fetch(`${API}/api/owner/campaigns`).then(r => r.json()),
  });
}

const TARGET_LABELS: Record<string, string> = {
  external: "External Contacts",
  platform_users: "Platform Users",
  broadcast: "All Users Broadcast",
};

const TARGET_ICONS: Record<string, typeof Mail> = {
  external: Users,
  platform_users: BarChart2,
  broadcast: Megaphone,
};

function PreviewModal({ campaign, onClose, onSend }: { campaign: Campaign; onClose: () => void; onSend: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">{campaign.name}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex gap-4 text-sm">
            <div className="flex-1 bg-white/5 rounded-xl p-3">
              <p className="text-white/40 text-xs mb-1">Subject</p>
              <p className="text-white">{campaign.subject}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-white/40 text-xs mb-1">Target</p>
              <p className="text-white text-sm">{TARGET_LABELS[campaign.targetType] ?? campaign.targetType}</p>
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-white/40 text-xs mb-2">Body</p>
            <pre className="text-white/80 text-sm whitespace-pre-wrap font-sans leading-relaxed">{campaign.body}</pre>
          </div>
          <p className="text-white/30 text-xs">A one-click unsubscribe link will be appended to every email automatically.</p>
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors">Close</button>
          <button
            onClick={() => { onSend(); onClose(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-black"
            style={{ background: "#fbbf24" }}
          >
            <Send className="w-4 h-4" />
            Send Now
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OwnerCampaigns() {
  const qc = useQueryClient();
  const { data: campaigns, isLoading } = useCampaigns();
  const [preview, setPreview] = useState<Campaign | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`${API}/api/owner/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-campaigns"] }),
  });

  const sendMut = useMutation({
    mutationFn: (id: number) => fetch(`${API}/api/owner/campaigns/${id}/send`, { method: "POST" }).then(r => r.json()),
    onSuccess: (data, id) => {
      if (data.error) { alert(`Send failed: ${data.error}`); return; }
      qc.invalidateQueries({ queryKey: ["owner-campaigns"] });
    },
  });

  const list = Array.isArray(campaigns) ? campaigns : [];

  return (
    <AdminLayout>
    <div className="max-w-5xl mx-auto">
      {preview && (
        <PreviewModal
          campaign={preview}
          onClose={() => setPreview(null)}
          onSend={() => sendMut.mutate(preview.id)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(251,191,36,0.15)" }}>
              <Mail className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
            </div>
            <h1 className="text-xl font-semibold text-white">Email Campaigns</h1>
          </div>
          <p className="text-white/40 text-sm">{list.length} campaigns · {list.filter(c => c.status === "sent").length} sent</p>
        </div>
        <Link href="/admin/owner/campaigns/new">
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-black"
            style={{ background: "#fbbf24" }}
          >
            <Plus className="w-4 h-4" />
            New Campaign
          </button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-white/30" />
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl flex flex-col items-center justify-center py-16 text-center">
          <Mail className="w-8 h-8 text-white/10 mb-3" />
          <p className="text-white/30 text-sm mb-4">No campaigns yet</p>
          <Link href="/admin/owner/campaigns/new">
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-black"
              style={{ background: "#fbbf24" }}
            >
              <Plus className="w-4 h-4" />
              Create your first campaign
            </button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(c => {
            const TargetIcon = TARGET_ICONS[c.targetType] ?? Mail;
            const isSent = c.status === "sent";
            const isSending = sendMut.isPending && sendMut.variables === c.id;
            return (
              <div key={c.id} className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        isSent ? "bg-green-500/10 text-green-400" : "bg-amber-400/10 text-amber-300"
                      }`}>
                        {isSent ? "Sent" : "Draft"}
                      </span>
                      <span className="flex items-center gap-1 text-white/30 text-xs">
                        <TargetIcon className="w-3 h-3" />
                        {TARGET_LABELS[c.targetType] ?? c.targetType}
                      </span>
                    </div>
                    <h3 className="text-white font-medium mb-0.5">{c.name}</h3>
                    <p className="text-white/40 text-sm truncate">Subject: {c.subject}</p>

                    {isSent && (
                      <div className="flex gap-5 mt-3">
                        {c.recipientCount != null && (
                          <div>
                            <p className="text-white text-base font-semibold">{c.recipientCount.toLocaleString()}</p>
                            <p className="text-white/30 text-xs">Sent</p>
                          </div>
                        )}
                        {c.openRate && (
                          <div>
                            <p className="text-white text-base font-semibold">{c.openRate}%</p>
                            <p className="text-white/30 text-xs">Opens</p>
                          </div>
                        )}
                        {c.clickRate && (
                          <div>
                            <p className="text-white text-base font-semibold">{c.clickRate}%</p>
                            <p className="text-white/30 text-xs">Clicks</p>
                          </div>
                        )}
                        {c.bounceRate && parseFloat(c.bounceRate) > 0 && (
                          <div>
                            <p className="text-white text-base font-semibold">{c.bounceRate}%</p>
                            <p className="text-white/30 text-xs">Bounces</p>
                          </div>
                        )}
                        {c.unsubscribeCount > 0 && (
                          <div>
                            <p className="text-white text-base font-semibold">{c.unsubscribeCount}</p>
                            <p className="text-white/30 text-xs">Unsubs</p>
                          </div>
                        )}
                        {c.sentAt && (
                          <div>
                            <p className="text-white/60 text-xs mt-1">{new Date(c.sentAt).toLocaleDateString()}</p>
                            <p className="text-white/30 text-xs">Date</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!isSent && (
                      <>
                        <button
                          onClick={() => setPreview(c)}
                          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                          title="Preview & Send"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Send "${c.name}" now?`)) sendMut.mutate(c.id); }}
                          disabled={isSending}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-black disabled:opacity-50"
                          style={{ background: "#fbbf24" }}
                          title="Send"
                        >
                          {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Send
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMut.mutate(c.id); }}
                          className="p-2 rounded-xl bg-white/5 hover:bg-red-500/10 text-white/30 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </AdminLayout>
  );
}
