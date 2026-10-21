import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, Send, Pause, Play, History, DollarSign, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Campaign } from "@workspace/api-client-react";

/** A campaign with the Google Ads external id (returned by the API but absent from the generated type). */
export type GoogleCampaign = Campaign & { source?: string; externalId?: string | null };

interface AdPlatformAction {
  id: number;
  actionType: string;
  campaignId: string | null;
  beforeState: string | null;
  afterState: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

// ── Publish to Google Ads ──────────────────────────────────────────────────────

export function PublishGoogleAdsModal({ projectId, onClose, onPublished }: {
  projectId: number;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [finalUrl, setFinalUrl] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");

  const publishMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          budgetAmount: Number(budget),
          finalUrl,
          headline,
          description,
          status: "PAUSED", // locked policy: create paused, resume when ready
        }),
      });
      const d = await r.json() as { error?: string; message?: string };
      if (!r.ok) throw new Error(d.error ?? "Publish failed");
      return d;
    },
    onSuccess: (d) => {
      toast({ title: "Campaign created", description: d.message ?? `Created "${name}" (paused).` });
      onPublished();
      onClose();
    },
    onError: (err) => toast({ title: "Publish failed", description: String(err), variant: "destructive" }),
  });

  const canSubmit = name.trim() && Number(budget) > 0 && finalUrl.trim() && headline.trim() && description.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg">Publish to Google Ads</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Creates a Search campaign (budget → campaign → ad group → responsive search ad). It starts <strong className="text-yellow-400">paused</strong> - resume it from the campaign card when ready.
        </p>

        <div className="space-y-3">
          <Field label="Campaign name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Sale - Search"
              className={inputCls} />
          </Field>
          <Field label="Daily budget (USD)">
            <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="10.00" inputMode="decimal"
              className={inputCls} />
          </Field>
          <Field label="Landing page URL">
            <input value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://example.com"
              className={inputCls} />
          </Field>
          <Field label="Headline">
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="30 characters max"
              maxLength={30} className={inputCls} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="90 characters max"
              maxLength={90} rows={2} className={inputCls} />
          </Field>
        </div>

        <button
          onClick={() => publishMutation.mutate()}
          disabled={publishMutation.isPending || !canSubmit}
          className="mt-5 w-full flex items-center justify-center gap-2 bg-[#4285F4] hover:bg-[#4285F4]/90 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors"
        >
          {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publish (paused)
        </button>
      </div>
    </div>
  );
}

// ── Audit history ──────────────────────────────────────────────────────────────

export function AuditHistoryModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const actionsQuery = useQuery({
    queryKey: ["google-ads-actions", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/actions`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load activity");
      return (await r.json()) as { actions: AdPlatformAction[] };
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl p-6 rounded-2xl bg-card border border-border max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Google Ads Activity</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {actionsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : actionsQuery.isError ? (
          <p className="text-sm text-red-400">Could not load activity history.</p>
        ) : (actionsQuery.data?.actions?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">No Google Ads actions yet. Publish or modify a campaign to see its audit trail here.</p>
        ) : (
          <div className="overflow-y-auto -mr-2 pr-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Action</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {actionsQuery.data!.actions.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-primary">{a.actionType}</span>
                      {a.campaignId && <div className="text-xs text-muted-foreground">Campaign {a.campaignId}</div>}
                      {a.afterState && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">after: {a.afterState}</div>}
                      {a.errorMessage && <div className="text-xs text-red-400 mt-0.5">error: {a.errorMessage}</div>}
                    </td>
                    <td className="py-2">
                      {a.status === "success" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> success</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400"><AlertCircle className="h-3 w-3" /> failed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Per-campaign actions (pause / resume / budget) ──────────────────────────────

export function GoogleAdsCampaignActions({ projectId, campaign, onChanged }: {
  projectId: number;
  campaign: GoogleCampaign;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const externalId = campaign.externalId;

  const statusMutation = useMutation({
    mutationFn: async (status: "ENABLED" | "PAUSED") => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/campaigns/${externalId}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Status update failed");
    },
    onSuccess: () => { toast({ title: "Campaign updated" }); onChanged(); },
    onError: (err) => toast({ title: "Update failed", description: String(err), variant: "destructive" }),
  });

  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const budgetMutation = useMutation({
    mutationFn: async (amount: number) => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/campaigns/${externalId}/budget`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetAmount: amount }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Budget update failed");
    },
    onSuccess: () => { toast({ title: "Budget updated" }); setEditingBudget(false); onChanged(); },
    onError: (err) => toast({ title: "Budget update failed", description: String(err), variant: "destructive" }),
  });

  if (!externalId) return null;
  const isActive = campaign.status === "active";

  return (
    <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-2">
      {isActive ? (
        <button
          onClick={() => statusMutation.mutate("PAUSED")}
          disabled={statusMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 text-yellow-400 text-xs font-bold transition-colors disabled:opacity-40"
        >
          {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />} Pause
        </button>
      ) : (
        <button
          onClick={() => statusMutation.mutate("ENABLED")}
          disabled={statusMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-bold transition-colors disabled:opacity-40"
        >
          {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Resume
        </button>
      )}

      {editingBudget ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">$</span>
          <input
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            inputMode="decimal"
            className="w-24 bg-black/30 border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#4285F4]/40"
          />
          <button
            onClick={() => budgetMutation.mutate(Number(budgetInput))}
            disabled={budgetMutation.isPending || !(Number(budgetInput) > 0)}
            className="px-2.5 py-1.5 rounded-lg bg-[#4285F4]/10 hover:bg-[#4285F4]/20 border border-[#4285F4]/20 text-[#4285F4] text-xs font-bold disabled:opacity-40"
          >
            Save
          </button>
          <button onClick={() => setEditingBudget(false)} className="px-2 py-1.5 rounded-lg text-muted-foreground hover:text-white text-xs">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => { setBudgetInput(String(campaign.budget ?? "")); setEditingBudget(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4285F4]/10 hover:bg-[#4285F4]/20 border border-[#4285F4]/20 text-[#4285F4] text-xs font-bold transition-colors"
        >
          <DollarSign className="h-3.5 w-3.5" /> {campaign.budget != null ? `$${Number(campaign.budget).toFixed(2)}` : "Edit budget"}
        </button>
      )}
    </div>
  );
}

// ── small helpers ───────────────────────────────────────────────────────────────

const inputCls = "w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-[#4285F4]/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
