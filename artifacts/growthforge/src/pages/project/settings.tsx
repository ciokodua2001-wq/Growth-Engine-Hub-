import { useParams } from "wouter";
import {
  useGetProject,
  useUpdateProject,
  getGetProjectQueryKey,
  useListProjectSources,
  useAddProjectSource,
  getListProjectSourcesQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings, Globe, Save, FileText, Lock, Target, MapPin, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { getClientRegion } from "@/lib/region";
import { useCurrentUser } from "@/hooks/use-current-user";

const ACCENT_PRESETS = ["#00E676", "#00D4FF", "#14F195", "#FF6B35", "#7C3AED", "#EC4899", "#F59E0B", "#3B82F6"];
const BUSINESS_GOALS = [
  "Get more customers",
  "Increase online sales",
  "Grow Instagram or Facebook presence",
  "Promote a new product or service",
  "Get more walk-in or phone enquiries",
  "Build a clearer marketing plan",
];

function parseDescription(description?: string | null) {
  const raw = description ?? "";
  return {
    about: raw.match(/About: (.*?)( \| |$)/)?.[1] ?? "",
    customers: raw.match(/Customers: (.*?)( \| |$)/)?.[1] ?? "",
    goal: raw.match(/Goal: (.*?)( \| |$)/)?.[1] ?? "",
    location: raw.match(/Location: (.*?)( \| |$)/)?.[1] ?? "",
  };
}

function composeDescription(values: { about: string; customers: string; goal: string; location: string }) {
  return [
    values.about.trim() ? `About: ${values.about.trim()}` : null,
    values.customers.trim() ? `Customers: ${values.customers.trim()}` : null,
    values.goal.trim() ? `Goal: ${values.goal.trim()}` : null,
    values.location.trim() ? `Location: ${values.location.trim()}` : null,
  ].filter(Boolean).join(" | ");
}

export default function ProjectSettings() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: project, isLoading } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [targetCustomers, setTargetCustomers] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState(BUSINESS_GOALS[0]);
  const [location, setLocation] = useState("");

  const [brandingCompanyName, setBrandingCompanyName] = useState("");
  const [brandingAccentColor, setBrandingAccentColor] = useState("#00E676");

  const region = getClientRegion();
  const { data: currentUserData } = useCurrentUser();
  const isOwner = currentUserData?.isOwner ?? false;
  const canWhiteLabel = isOwner || project?.plan === "growth" || project?.plan === "agency";

  useEffect(() => {
    if (project) {
      const parsed = parseDescription(project.description);
      setName(project.name);
      setWebsiteUrl(project.websiteUrl ?? "");
      setIndustry(project.industry ?? "");
      setBusinessDescription(parsed.about);
      setTargetCustomers(parsed.customers);
      setPrimaryGoal(parsed.goal || BUSINESS_GOALS[0]);
      setLocation(parsed.location);
      setBrandingCompanyName(project.brandingCompanyName ?? "");
      setBrandingAccentColor(project.brandingAccentColor ?? "#00E676");
    }
  }, [project]);

  const { data: sources = [], isLoading: sourcesLoading } = useListProjectSources(projectId, {
    query: { queryKey: getListProjectSourcesQueryKey(projectId), enabled: !!projectId },
  });
  const addSource = useAddProjectSource();
  const [newSourceType, setNewSourceType] = useState("instagram");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceDesc, setNewSourceDesc] = useState("");

  const handleAddSource = () => {
    if (newSourceType === "whatsapp") {
      toast({ title: "WhatsApp is not a supported GrowthForge source", description: "Describe WhatsApp-led selling in the notes instead.", variant: "destructive" });
      return;
    }
    if (!newSourceType || (!newSourceUrl.trim() && !newSourceDesc.trim())) {
      toast({ title: "Add a URL or a description", variant: "destructive" });
      return;
    }
    addSource.mutate(
      { id: projectId, data: { sourceType: newSourceType, sourceUrl: newSourceUrl.trim() || undefined, declaredContent: newSourceDesc.trim() || undefined } },
      {
        onSuccess: () => {
          setNewSourceUrl("");
          setNewSourceDesc("");
          toast({ title: "Source added!" });
          queryClient.invalidateQueries({ queryKey: getListProjectSourcesQueryKey(projectId) });
        },
        onError: () => toast({ title: "Could not add source", variant: "destructive" }),
      },
    );
  };

  const handleSave = () => {
    updateProject.mutate(
      {
        id: projectId,
        data: {
          name,
          websiteUrl,
          industry: industry || undefined,
          description: composeDescription({ about: businessDescription, customers: targetCustomers, goal: primaryGoal, location }),
        } as never,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          toast({ title: "Business profile saved!" });
        },
        onError: () => toast({ title: "Could not save business profile", variant: "destructive" }),
      }
    );
  };

  const handleSaveBranding = () => {
    updateProject.mutate(
      {
        id: projectId,
        data: {
          brandingCompanyName: brandingCompanyName.trim() || null,
          brandingAccentColor: brandingAccentColor || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          toast({ title: "Branding saved!", description: "Your next PDF export will use this branding." });
        },
        onError: () => toast({ title: "Error saving branding", variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
          <Settings className="h-7 w-7 text-muted-foreground" /> Account & Business Settings
        </h1>
        <p className="text-muted-foreground mt-1">{region === "nigeria" ? "Update your business details, supported online presence, and workspace preferences for your Nigerian market setup." : "Manage your project configuration and AI preferences"}</p>
      </div>

      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-xl bg-card border border-border">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Business Profile</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Business name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Business category</label>
              <input type="text" value={industry} onChange={e => setIndustry(e.target.value)} placeholder="Example: Fashion and clothing" className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Short business description</label>
              <textarea value={businessDescription} onChange={e => setBusinessDescription(e.target.value)} rows={4} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Target customers</label>
              <textarea value={targetCustomers} onChange={e => setTargetCustomers(e.target.value)} rows={3} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block"><Target className="inline h-4 w-4 mr-1" />Primary marketing goal</label>
                <select value={primaryGoal} onChange={e => setPrimaryGoal(e.target.value)} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors">
                  {BUSINESS_GOALS.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block"><MapPin className="inline h-4 w-4 mr-1" />Business location (optional)</label>
                <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Example: Yaba, Lagos" className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Website URL (optional)</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input type="url" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-5">
            <button onClick={handleSave} disabled={updateProject.isPending} className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
              {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className={`p-6 rounded-xl border ${canWhiteLabel ? "bg-card border-border" : "bg-card/50 border-border/50"}`}>
          <div className="flex items-start justify-between mb-1">
            <h2 className="font-bold flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> White-Label Reports</h2>
            {!canWhiteLabel && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20"><Lock className="h-2.5 w-2.5" /> Growth+</span>}
          </div>
          <p className="text-sm text-muted-foreground mb-5">Export Competitor Reports, Marketing Strategy, and Campaign Performance PDFs with your own branding instead of GrowthForge.</p>
          {!canWhiteLabel ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300/80">Upgrade to the <strong>Growth</strong> plan or higher to unlock white-label PDF exports.</div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium mb-2 block">Company Name</label>
                <input type="text" value={brandingCompanyName} onChange={e => setBrandingCompanyName(e.target.value)} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors" />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Accent Color</label>
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENT_PRESETS.map(c => (
                    <button key={c} onClick={() => setBrandingAccentColor(c)} className={`w-7 h-7 rounded-lg border-2 transition-all ${brandingAccentColor === c ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100"}`} style={{ backgroundColor: c }} title={c} />
                  ))}
                  <div className="flex items-center gap-2 ml-1">
                    <input type="color" value={brandingAccentColor} onChange={e => setBrandingAccentColor(e.target.value)} className="w-7 h-7 rounded-lg cursor-pointer border border-border bg-transparent p-0.5" title="Custom color" />
                    <span className="text-xs text-muted-foreground font-mono">{brandingAccentColor}</span>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={handleSaveBranding} disabled={updateProject.isPending} className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
                  {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Branding
                </button>
              </div>
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="p-6 rounded-xl bg-card border border-border">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /> Connected Sources</h2>
          <p className="text-sm text-muted-foreground mb-4">Where GrowthForge learns about this business. Supported public sources can be listed here. WhatsApp is not a supported analytics source.</p>
          {sourcesLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : sources.length === 0 ? (
            <div className="text-sm text-muted-foreground mb-4">{region === "nigeria" ? "No sources yet. Add your website or public business pages. If customers mostly contact you on WhatsApp or by phone, describe that in the source notes instead of adding it as a supported channel." : "No sources yet."}</div>
          ) : (
            <ul className="space-y-2 mb-4">
              {sources.map((src) => (
                <li key={src.id} className="flex items-center justify-between text-sm border border-border rounded-lg px-3 py-2">
                  <div>
                    <span className="font-medium capitalize">{src.sourceType}</span>
                    {src.displayLabel && <span className="text-muted-foreground ml-2">{src.displayLabel}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{src.retrievalMethod === "http_fetch" ? "auto-read" : "declared"}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 mb-2">
            <select value={newSourceType} onChange={(e) => setNewSourceType(e.target.value)} className="bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm">
              {["website", "instagram", "facebook", "tiktok", "youtube", "linkedin", "manual"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} placeholder="URL or handle" className="bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <textarea value={newSourceDesc} onChange={(e) => setNewSourceDesc(e.target.value)} rows={2} placeholder="Optional description" className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <button onClick={handleAddSource} disabled={addSource.isPending} className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-4 py-2 rounded-lg text-sm">{addSource.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add source</button>
        </motion.div>
      </div>
    </div>
  );
}
