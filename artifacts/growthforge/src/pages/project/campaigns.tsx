import { useParams, useSearch } from "wouter";
import {
  useListCampaigns,
  useCreateCampaign,
  getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Target, Plus, X, RefreshCw, Link2, Unlink,
  CheckCircle2, AlertCircle, Clock, Wand2, ChevronRight, ChevronLeft,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

const statusColors: Record<string, string> = {
  draft:     "bg-slate-500/15 text-slate-400 border-slate-500/20",
  active:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  paused:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const platformOpts = ["Google", "Meta", "LinkedIn", "TikTok", "YouTube", "Email"];

// ── Google Ads connection panel ───────────────────────────────────────────────

interface AdStatus {
  connected: boolean;
  devTokenConfigured: boolean;
  oauthConfigured: boolean;
  account: { customerId: string | null; accountName: string | null; accountEmail: string | null; lastSyncAt: string | null } | null;
}

function GoogleAdsPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();

  const statusQuery = useQuery<AdStatus>({
    queryKey: ["google-ads-status", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/status`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load status");
      return r.json();
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("google_ads") === "connected") {
      toast({ title: "Google Ads connected!", description: "You can now sync your campaigns." });
      statusQuery.refetch();
    } else if (params.get("google_ads") === "error") {
      toast({ title: "Connection failed", description: "Could not connect Google Ads. Please try again.", variant: "destructive" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      return r.json() as Promise<{ synced: number; message: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Synced!", description: data.message });
      statusQuery.refetch();
      queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(projectId) });
    },
    onError: (err) => toast({ title: "Sync failed", description: String(err), variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/disconnect`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Disconnect failed");
    },
    onSuccess: () => {
      toast({ title: "Disconnected from Google Ads" });
      statusQuery.refetch();
      queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(projectId) });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/auth-url`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not get auth URL");
      const { url } = await r.json() as { url: string };
      window.location.href = url;
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const [customerIdInput, setCustomerIdInput] = useState("");
  const setCustomerIdMutation = useMutation({
    mutationFn: async (cid: string) => {
      const r = await fetch(`/api/projects/${projectId}/google-ads/customer-id`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: cid }),
      });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      return r.json() as Promise<{ customerId: string }>;
    },
    onSuccess: () => {
      toast({ title: "Account ID saved", description: "Click Sync Now to import your campaigns." });
      setCustomerIdInput("");
      statusQuery.refetch();
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const status = statusQuery.data;
  const loading = statusQuery.isLoading;

  if (loading) {
    return (
      <div className="mb-6 p-4 rounded-xl border border-border bg-card/50 flex items-center gap-3 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" /> Checking Google Ads connection…
      </div>
    );
  }

  // OAuth not configured yet
  if (!status?.oauthConfigured) {
    return (
      <div className="mb-6 p-5 rounded-xl border border-border bg-card/50">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-[#4285F4]/10">
            <GoogleAdsIcon />
          </div>
          <div>
            <p className="font-semibold text-sm">Connect Google Ads</p>
            <p className="text-xs text-muted-foreground">Import real campaign data automatically</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-yellow-400 font-medium">
            <Clock className="h-3.5 w-3.5" /> Setup pending
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Add <code className="bg-secondary px-1 py-0.5 rounded text-[#00E676]">GOOGLE_ADS_CLIENT_ID</code> and <code className="bg-secondary px-1 py-0.5 rounded text-[#00E676]">GOOGLE_ADS_CLIENT_SECRET</code> to Replit Secrets to enable Google Ads sync.
        </p>
      </div>
    );
  }

  if (status.connected && status.account) {
    const lastSync = status.account.lastSyncAt
      ? new Date(status.account.lastSyncAt).toLocaleString()
      : "Never";

    return (
      <div className="mb-6 p-4 rounded-xl border border-[#00E676]/20 bg-[#00E676]/5">
        {/* Row 1: icon + name + badge */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 rounded-lg bg-[#4285F4]/10 shrink-0">
            <GoogleAdsIcon />
          </div>
          <p className="font-semibold text-sm">Google Ads</p>
          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded shrink-0">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        </div>
        {/* Row 2: account info */}
        <p className="text-xs text-muted-foreground mb-3 pl-0.5">
          {status.account.accountEmail ?? status.account.accountName ?? `Customer: ${status.account.customerId}`}
          <span className="mx-1.5 opacity-40">·</span>
          Last sync: {lastSync}
        </p>
        {!status.devTokenConfigured && (
          <p className="text-xs text-yellow-400/80 mb-2 flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3 shrink-0" /> Developer token pending approval
          </p>
        )}
        {/* Row 3: action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !status.devTokenConfigured}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00E676]/10 hover:bg-[#00E676]/20 border border-[#00E676]/20 text-[#00E676] text-xs font-bold transition-colors disabled:opacity-40"
          >
            {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Now
          </button>
          <button
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-500/10 border border-border hover:border-red-500/20 text-muted-foreground hover:text-red-400 text-xs font-medium transition-colors"
          >
            <Unlink className="h-3.5 w-3.5" /> Disconnect
          </button>
        </div>
        {!status.account.customerId && (
          <div className="mt-3 pt-3 border-t border-[#00E676]/10">
            <p className="text-xs text-yellow-400/80 mb-2">
              Account ID not detected automatically. Enter your Google Ads Customer ID (e.g. <code className="bg-black/20 px-1 rounded">549-416-8584</code>) to enable sync:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customerIdInput}
                onChange={e => setCustomerIdInput(e.target.value)}
                placeholder="e.g. 549-416-8584"
                className="flex-1 bg-black/30 border border-border rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-[#00E676]/40"
              />
              <button
                onClick={() => setCustomerIdMutation.mutate(customerIdInput)}
                disabled={!customerIdInput.trim() || setCustomerIdMutation.isPending}
                className="px-3 py-1.5 rounded-lg bg-[#00E676]/10 hover:bg-[#00E676]/20 border border-[#00E676]/20 text-[#00E676] text-xs font-bold transition-colors disabled:opacity-40"
              >
                {setCustomerIdMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        )}
        {!status.devTokenConfigured && (
          <p className="mt-3 text-xs text-yellow-400/80">
            Your developer token is awaiting Google's approval. Once approved, add <code className="bg-black/20 px-1 rounded">GOOGLE_ADS_DEVELOPER_TOKEN</code> to Replit Secrets and click Sync.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 p-4 rounded-xl border border-border bg-card/50">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="p-2 rounded-lg bg-[#4285F4]/10 shrink-0">
          <GoogleAdsIcon />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm">Connect Google Ads</p>
          <p className="text-xs text-muted-foreground">Import real campaigns, spend, clicks & conversions automatically</p>
        </div>
      </div>
      <button
        onClick={() => connectMutation.mutate()}
        disabled={connectMutation.isPending}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#4285F4] hover:bg-[#4285F4]/90 text-white text-sm font-bold transition-colors disabled:opacity-50"
      >
        {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        Connect Google Ads
      </button>
    </div>
  );
}

function GoogleAdsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 16.5L8.5 5l3.5 6-3 5.5H2z" fill="#FBBC04"/>
      <path d="M21.5 16.5h-7L11 11l3.5-6L21.5 16.5z" fill="#4285F4"/>
      <circle cx="17.5" cy="16.5" r="3.5" fill="#34A853"/>
    </svg>
  );
}

// ── Meta Ads connection panel ─────────────────────────────────────────────────

interface MetaStatus {
  connected: boolean;
  oauthConfigured: boolean;
  tokenExpiresSoon: boolean;
  account: { customerId: string | null; accountName: string | null; accountEmail: string | null; lastSyncAt: string | null } | null;
}

function MetaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" fill="#1877F2"/>
    </svg>
  );
}

function MetaAdsPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();

  const statusQuery = useQuery<MetaStatus>({
    queryKey: ["meta-status", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/meta/status`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load status");
      return r.json();
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("meta") === "connected") {
      toast({ title: "Meta connected!", description: "You can now sync your Facebook/Instagram campaigns." });
      statusQuery.refetch();
    } else if (params.get("meta") === "error") {
      toast({ title: "Meta connection failed", description: "Could not connect Meta Ads. Please try again.", variant: "destructive" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/meta/sync`, { method: "POST", credentials: "include" });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      return r.json() as Promise<{ synced: number; message: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Synced!", description: data.message });
      statusQuery.refetch();
      queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(projectId) });
    },
    onError: (err) => toast({ title: "Sync failed", description: String(err), variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/meta/disconnect`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Disconnect failed");
    },
    onSuccess: () => {
      toast({ title: "Disconnected from Meta Ads" });
      statusQuery.refetch();
      queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(projectId) });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/meta/auth-url`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not get auth URL");
      const { url } = await r.json() as { url: string };
      window.location.href = url;
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const status = statusQuery.data;
  if (statusQuery.isLoading) return null;

  if (!status?.oauthConfigured) {
    return (
      <div className="mb-3 p-4 rounded-xl border border-border bg-card/50">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 rounded-lg bg-[#1877F2]/10 shrink-0"><MetaIcon /></div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Connect Meta Ads</p>
            <p className="text-xs text-muted-foreground">Import Facebook & Instagram campaign data</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-yellow-400 font-medium shrink-0">
            <Clock className="h-3.5 w-3.5" /> Setup pending
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Add <code className="bg-secondary px-1 py-0.5 rounded text-[#00E676]">META_APP_ID</code> and <code className="bg-secondary px-1 py-0.5 rounded text-[#00E676]">META_APP_SECRET</code> to Replit Secrets to enable Meta sync.
        </p>
      </div>
    );
  }

  if (status.connected && status.account) {
    const lastSync = status.account.lastSyncAt ? new Date(status.account.lastSyncAt).toLocaleString() : "Never";
    return (
      <div className="mb-3 p-4 rounded-xl border border-[#1877F2]/20 bg-[#1877F2]/5">
        {/* Row 1: icon + name + badge */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 rounded-lg bg-[#1877F2]/10 shrink-0"><MetaIcon /></div>
          <p className="font-semibold text-sm">Meta Ads</p>
          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded shrink-0">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
          {status.tokenExpiresSoon && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400 font-medium shrink-0">
              <AlertCircle className="h-3 w-3" /> Expiring soon
            </span>
          )}
        </div>
        {/* Row 2: account info */}
        <p className="text-xs text-muted-foreground mb-3 pl-0.5">
          {status.account.accountEmail ?? status.account.accountName ?? `Account: ${status.account.customerId}`}
          <span className="mx-1.5 opacity-40">·</span>
          Last sync: {lastSync}
        </p>
        {/* Row 3: action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1877F2]/10 hover:bg-[#1877F2]/20 border border-[#1877F2]/20 text-[#1877F2] text-xs font-bold transition-colors disabled:opacity-40"
          >
            {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Now
          </button>
          <button
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-500/10 border border-border hover:border-red-500/20 text-muted-foreground hover:text-red-400 text-xs font-medium transition-colors"
          >
            <Unlink className="h-3.5 w-3.5" /> Disconnect
          </button>
        </div>
        {status.tokenExpiresSoon && (
          <p className="mt-3 text-xs text-yellow-400/80">
            Your Meta access token is expiring soon. Click Disconnect then reconnect to refresh it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 p-4 rounded-xl border border-border bg-card/50">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="p-2 rounded-lg bg-[#1877F2]/10 shrink-0"><MetaIcon /></div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Connect Meta Ads</p>
          <p className="text-xs text-muted-foreground">Import Facebook & Instagram campaigns, spend & conversions</p>
        </div>
      </div>
      <button
        onClick={() => connectMutation.mutate()}
        disabled={connectMutation.isPending}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#1877F2]/90 text-white text-sm font-bold transition-colors disabled:opacity-50"
      >
        {connectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        Connect Meta Ads
      </button>
    </div>
  );
}

// ── New Campaign Modal ─────────────────────────────────────────────────────────

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

// ── AI Campaign Builder Modal ──────────────────────────────────────────────────

interface CampaignBuilderResult {
  campaign: { id: number; name: string; platform: string; status: string; createdAt: string };
  socialPosts: Array<{ id: number; platform: string; caption: string }>;
  emails: Array<{ id: number; subject: string }>;
  ads: Array<{ id: number; headline: string }>;
}

const CAMPAIGN_GOALS = ["Product Launch", "Brand Awareness", "Seasonal Campaign", "Lead Generation", "Customer Retention"];
const CAMPAIGN_CHANNELS = [
  { id: "social", label: "Social Posts", desc: "Facebook & Instagram posts (4 total)" },
  { id: "email", label: "Email Campaign", desc: "Targeted sales email blast" },
  { id: "ads", label: "Ad Creatives", desc: "Meta ad copy & creatives (3 ads)" },
];

function AICampaignBuilderModal({ projectId, onClose, onBuilt }: { projectId: number; onClose: () => void; onBuilt: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [goal, setGoal] = useState("Product Launch");
  const [theme, setTheme] = useState("");
  const [channels, setChannels] = useState<string[]>(["social", "email", "ads"]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CampaignBuilderResult | null>(null);

  const toggleChannel = (c: string) => setChannels(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const handleBuild = async () => {
    if (!theme.trim() || channels.length === 0) return;
    setIsBuilding(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/campaigns/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ goal, theme, channels }),
      });
      const d = await r.json() as CampaignBuilderResult & { error?: string };
      if (!r.ok) { setError(d.error ?? "Failed to build campaign"); return; }
      setResult(d);
      setStep(3);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
              <Wand2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-black">AI Campaign Builder</h2>
              <p className="text-xs text-muted-foreground">
                {step === 1 ? "Define your campaign goal & theme" : step === 2 ? "Choose your channels" : "Campaign generated!"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-bold mb-2 block">Campaign Goal</label>
                <div className="grid grid-cols-2 gap-2">
                  {CAMPAIGN_GOALS.map(g => (
                    <button key={g} onClick={() => setGoal(g)}
                      className={`text-xs font-medium px-3 py-2 rounded-xl border transition-all text-left ${goal === g ? "bg-primary/15 border-primary/30 text-primary" : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-bold mb-2 block">Campaign Theme <span className="text-primary">*</span></label>
                <input type="text" value={theme} onChange={e => setTheme(e.target.value)}
                  placeholder='e.g. "Spring Sale — 30% off everything"'
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm placeholder-muted-foreground focus:outline-none focus:border-primary/40 transition-colors" />
                <p className="text-xs text-muted-foreground mt-1.5">The central message that unifies all your campaign content</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground mb-1">AI will generate coordinated, on-brand content across all selected channels in one shot.</p>
              {CAMPAIGN_CHANNELS.map(ch => (
                <button key={ch.id} onClick={() => toggleChannel(ch.id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${channels.includes(ch.id) ? "bg-primary/10 border-primary/30" : "bg-secondary/50 border-border hover:border-border/80"}`}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${channels.includes(ch.id) ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                    {channels.includes(ch.id) && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  <div>
                    <p className="text-sm font-bold">{ch.label}</p>
                    <p className="text-xs text-muted-foreground">{ch.desc}</p>
                  </div>
                </button>
              ))}
              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            </div>
          )}

          {step === 3 && result && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-400">Campaign Created!</span>
                </div>
                <p className="text-xs text-muted-foreground">"{result.campaign.name}" — content is ready across your selected channels.</p>
              </div>
              {result.socialPosts.length > 0 && (
                <div className="p-3 rounded-xl bg-secondary/50 border border-border">
                  <p className="text-xs font-bold mb-1">{result.socialPosts.length} Social Posts →  Social Media Hub</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{result.socialPosts[0]?.caption}</p>
                </div>
              )}
              {result.emails.length > 0 && (
                <div className="p-3 rounded-xl bg-secondary/50 border border-border">
                  <p className="text-xs font-bold mb-1">Email Campaign → Email Marketing</p>
                  <p className="text-xs text-muted-foreground">{result.emails[0]?.subject}</p>
                </div>
              )}
              {result.ads.length > 0 && (
                <div className="p-3 rounded-xl bg-secondary/50 border border-border">
                  <p className="text-xs font-bold mb-1">{result.ads.length} Ad Creatives → Ad Studio</p>
                  <p className="text-xs text-muted-foreground">{result.ads[0]?.headline}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-6 border-t border-border">
          {step === 1 && (
            <>
              <div />
              <button onClick={() => setStep(2)} disabled={!theme.trim()}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={handleBuild} disabled={channels.length === 0 || isBuilding}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
                {isBuilding ? <><Loader2 className="h-4 w-4 animate-spin" /> Building…</> : <><Wand2 className="h-4 w-4" /> Build Campaign</>}
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <div />
              <button onClick={() => { onBuilt(); onClose(); }}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
                Done <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ProjectCampaigns() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [showModal, setShowModal] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useListCampaigns(projectId, { query: { queryKey: getListCampaignsQueryKey(projectId), enabled: !!projectId } });

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Campaign Manager</h1>
          <p className="text-muted-foreground mt-1">AI-managed campaigns with autonomous optimization</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => setShowBuilder(true)}
            className="flex items-center gap-2 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20 font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Wand2 className="h-4 w-4" /> AI Builder
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Plus className="h-4 w-4" /> Create Campaign
          </button>
        </div>
      </div>

      <GoogleAdsPanel projectId={projectId} />
      <MetaAdsPanel projectId={projectId} />

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : campaigns && campaigns.length > 0 ? (
        <div className="space-y-4">
          <AnimatePresence>
            {campaigns.map((campaign, i) => (
              <motion.div
                key={campaign.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-6 rounded-xl bg-card border border-border"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg">{campaign.name}</h3>
                      {(campaign as { source?: string }).source === "google_ads" && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20">
                          <GoogleAdsIcon /> Google Ads
                        </span>
                      )}
                    </div>
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
                    { label: "Clicks",      value: campaign.clicks?.toLocaleString() ?? "—" },
                    { label: "Conversions", value: campaign.conversions?.toLocaleString() ?? "—" },
                    { label: "CTR",         value: campaign.ctr != null ? `${Number(campaign.ctr).toFixed(2)}%` : "—" },
                    { label: "CPC",         value: campaign.cpc != null ? `$${Number(campaign.cpc).toFixed(2)}` : "—" },
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
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Target className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Campaigns Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Connect Google Ads to import real campaigns, or create one manually.</p>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Plus className="h-4 w-4" /> Create First Campaign
          </button>
        </div>
      )}

      {showModal && <NewCampaignModal projectId={projectId} onClose={() => setShowModal(false)} />}
      <AnimatePresence>
        {showBuilder && (
          <AICampaignBuilderModal
            projectId={projectId}
            onClose={() => setShowBuilder(false)}
            onBuilt={() => {
              void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(projectId) });
              setShowBuilder(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
