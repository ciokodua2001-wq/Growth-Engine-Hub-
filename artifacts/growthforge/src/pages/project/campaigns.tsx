import { useParams } from "wouter";
import {
  useListCampaigns,
  useCreateCampaign,
  getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Target, Plus, X, TrendingUp, TrendingDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const statusColors: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  paused: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const platformOpts = ["Google", "Meta", "LinkedIn", "TikTok", "YouTube", "Email"];

function NewCampaignModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("Meta");
  const [budget, setBudget] = useState("");
  const createCampaign = useCreateCampaign();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCampaign.mutate(
      { id: projectId, data: { name, platform, budget: budget ? parseFloat(budget) : undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(projectId) });
          toast({ title: "Campaign created!" });
          onClose();
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-card border border-border rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Create Campaign</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Campaign Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Q1 Brand Awareness" className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Platform</label>
            <select value={platform} onChange={e => setPlatform(e.target.value)} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              {platformOpts.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Monthly Budget ($) <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="2000" className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <button type="submit" disabled={createCampaign.isPending || !name} className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold py-3.5 rounded-xl transition-all mt-2">
            {createCampaign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Campaign
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export default function ProjectCampaigns() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [showModal, setShowModal] = useState(false);
  const { data: campaigns, isLoading } = useListCampaigns(projectId, { query: { enabled: !!projectId } });
  const { toast } = useToast();

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Campaign Manager</h1>
          <p className="text-muted-foreground mt-1">AI-managed campaigns with autonomous optimization</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
        >
          <Plus className="h-4 w-4" /> Create Campaign
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : campaigns && campaigns.length > 0 ? (
        <div className="space-y-4">
          {campaigns.map((campaign, i) => (
            <motion.div
              key={campaign.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="p-6 rounded-xl bg-card border border-border"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-lg">{campaign.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{campaign.platform}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${statusColors[campaign.status] ?? "bg-secondary text-muted-foreground border-border"}`}>
                      {campaign.status}
                    </span>
                  </div>
                </div>
                {campaign.roas != null && (
                  <div className="text-right">
                    <div className="text-2xl font-black text-primary">{campaign.roas}x</div>
                    <div className="text-xs text-muted-foreground">ROAS</div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: "Impressions", value: campaign.impressions?.toLocaleString() ?? "—" },
                  { label: "Clicks", value: campaign.clicks?.toLocaleString() ?? "—" },
                  { label: "Conversions", value: campaign.conversions?.toLocaleString() ?? "—" },
                  { label: "CTR", value: campaign.ctr != null ? `${Number(campaign.ctr).toFixed(2)}%` : "—" },
                  { label: "CPC", value: campaign.cpc != null ? `$${Number(campaign.cpc).toFixed(2)}` : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <div className="text-base font-bold">{value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {campaign.budget != null && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Budget utilization</span>
                    <span>${campaign.spent != null ? Number(campaign.spent).toFixed(0) : 0} / ${Number(campaign.budget).toFixed(0)}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, (Number(campaign.spent ?? 0) / Number(campaign.budget)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Target className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Campaigns Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Create AI-managed campaigns across Google, Meta, LinkedIn, and more.</p>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Plus className="h-4 w-4" /> Create First Campaign
          </button>
        </div>
      )}

      {showModal && <NewCampaignModal projectId={projectId} onClose={() => setShowModal(false)} />}
    </div>
  );
}
