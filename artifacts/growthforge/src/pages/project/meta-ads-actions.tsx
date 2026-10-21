import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, X, Send, Pause, Play, History, DollarSign, CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Campaign } from "@workspace/api-client-react";

export type MetaCampaign = Campaign & { source?: string; externalId?: string | null };

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

// ── Publish / Validate Modal ───────────────────────────────────────────────────

export function PublishMetaAdsModal({ projectId, isConnected, onClose, onPublished }: {
  projectId: number;
  isConnected: boolean;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [finalUrl, setFinalUrl] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");

  const submitMutation = useMutation({
    mutationFn: async (validateOnly: boolean) => {
      const r = await fetch(`/api/projects/${projectId}/meta/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          budgetAmount: Number(budget),
          finalUrl,
          headline,
          description,
          status: "PAUSED",
          validateOnly,
        }),
      });
      const d = await r.json() as { error?: string; message?: string };
      if (!r.ok) throw new Error(d.error ?? "Action failed");
      return d;
    },
    onSuccess: (d, validateOnly) => {
      if (validateOnly) {
        toast({ title: "Dry-Run Validation Passed!", description: d.message ?? "Campaign structure, character limits, and budget passed validation." });
      } else {
        toast({ title: "Campaign Created", description: d.message ?? `Created "${name}" (paused).` });
        onPublished();
        onClose();
      }
    },
    onError: (err) => toast({ title: "Validation failed", description: String(err), variant: "destructive" }),
  });

  const canSubmit = name.trim() && Number(budget) > 0 && finalUrl.trim() && headline.trim() && description.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg p-6 rounded-2xl bg-card border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg">Meta Ads Campaign Publisher</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {!isConnected ? (
          <div className="mb-4 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Account not connected yet.</strong> Run <strong>Validate (Dry Run)</strong> to test campaign structure, character limits, and budget rules before connecting Meta Ads.
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-4">
            Creates a Traffic campaign (campaign → ad set → link ad). Live creation defaults to <strong className="text-yellow-400">paused</strong> until you hit Resume.
          </p>
        )}

        <div className="space-y-3">
          <Field label="Campaign name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Allbirds Traffic" className={inputCls} />
          </Field>
          <Field label="Daily budget (USD)">
            <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="10.00" inputMode="decimal" className={inputCls} />
          </Field>
          <Field label="Landing page URL">
            <input value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://example.com" className={inputCls} />
          </Field>
          <Field label={`Headline / link title (${headline.length}/25)`}>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="25 characters max" maxLength={25} className={inputCls} />
          </Field>
          <Field label={`Primary text (${description.length}/125)`}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="125 characters max" maxLength={125} rows={2} className={inputCls} />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => submitMutation.mutate(true)}
            disabled={submitMutation.isPending || !canSubmit}
            className="flex-1 flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold py-3 rounded-xl transition-colors disabled:opacity-40 text-sm"
          >
            {submitMutation.isPending && submitMutation.variables === true ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 text-emerald-400" />}
            Validate (Dry Run)
          </button>
          <button
            type="button"
            onClick={() => submitMutation.mutate(false)}
            disabled={submitMutation.isPending || !canSubmit || !isConnected}
            className="flex-1 flex items-center justify-center gap-2 bg-[#1877F2] hover:bg-[#1877F2]/90 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors text-sm"
          >
            {submitMutation.isPending && submitMutation.variables === false ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publish Live
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Audit history ──────────────────────────────────────────────────────────────

export function MetaAuditHistoryModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const actionsQuery = useQuery({
    queryKey: ["meta-actions", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/meta/actions`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load activity");
      return (await r.json()) as { actions: AdPlatformAction[] };
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl p-6 rounded-2xl bg-card border border-border max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-lg">Meta Ads Audit Log</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {actionsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : actionsQuery.isError ? (
          <p className="text-sm text-red-400">Could not load activity history.</p>
        ) : (actionsQuery.data?.actions?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">No Meta Ads actions yet. Use Validate (Dry Run) or Publish to test campaign actions.</p>
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

export function MetaAdsCampaignActions({ projectId, campaign, onChanged }: {
  projectId: number;
  campaign: MetaCampaign;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const externalId = campaign.externalId;

  const statusMutation = useMutation({
    mutationFn: async (status: "ACTIVE" | "PAUSED") => {
      const r = await fetch(`/api/projects/${projectId}/meta/campaigns/${externalId}/status`, {
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
      const r = await fetch(`/api/projects/${projectId}/meta/campaigns/${externalId}/budget`, {
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
          onClick={() => statusMutation.mutate("ACTIVE")}
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
            className="w-24 bg-black/30 border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#1877F2]/40"
          />
          <button
            onClick={() => budgetMutation.mutate(Number(budgetInput))}
            disabled={budgetMutation.isPending || !(Number(budgetInput) > 0)}
            className="px-2.5 py-1.5 rounded-lg bg-[#1877F2]/10 hover:bg-[#1877F2]/20 border border-[#1877F2]/20 text-[#1877F2] text-xs font-bold disabled:opacity-40"
          >
            Save
          </button>
          <button onClick={() => setEditingBudget(false)} className="px-2 py-1.5 rounded-lg text-muted-foreground hover:text-white text-xs">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => { setBudgetInput(String(campaign.budget ?? "")); setEditingBudget(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1877F2]/10 hover:bg-[#1877F2]/20 border border-[#1877F2]/20 text-[#1877F2] text-xs font-bold transition-colors"
        >
          <DollarSign className="h-3.5 w-3.5" /> {campaign.budget != null ? `$${Number(campaign.budget).toFixed(2)}` : "Edit budget"}
        </button>
      )}
    </div>
  );
}

// ── small helpers ───────────────────────────────────────────────────────────────

const inputCls = "w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-[#1877F2]/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
