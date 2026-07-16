import { useParams } from "wouter";
import {
  useGetProject,
  useUpdateProject,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings, Globe, Zap, Bot, Save, FileText, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

const ACCENT_PRESETS = [
  "#00E676", "#00D4FF", "#14F195", "#FF6B35",
  "#7C3AED", "#EC4899", "#F59E0B", "#3B82F6",
];

export default function ProjectSettings() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: project, isLoading } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [autonomousMode, setAutonomousMode] = useState(false);

  const [brandingCompanyName, setBrandingCompanyName] = useState("");
  const [brandingAccentColor, setBrandingAccentColor] = useState("#00E676");

  const canWhiteLabel = project?.plan === "growth" || project?.plan === "agency";

  useEffect(() => {
    if (project) {
      setName(project.name);
      setWebsiteUrl(project.websiteUrl);
      setAutonomousMode(project.autonomousMode ?? false);
      setBrandingCompanyName(project.brandingCompanyName ?? "");
      setBrandingAccentColor(project.brandingAccentColor ?? "#00E676");
    }
  }, [project]);

  const handleSave = () => {
    updateProject.mutate(
      { id: projectId, data: { name, websiteUrl, autonomousMode } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          toast({ title: "Settings saved!" });
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
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
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
          <Settings className="h-7 w-7 text-muted-foreground" /> Project Settings
        </h1>
        <p className="text-muted-foreground mt-1">Manage your project configuration and AI preferences</p>
      </div>

      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-xl bg-card border border-border">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /> Project Details</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Website URL</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={e => setWebsiteUrl(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-5">
            <button
              onClick={handleSave}
              disabled={updateProject.isPending}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </motion.div>

        {/* White-Label Branding */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className={`p-6 rounded-xl border ${canWhiteLabel ? "bg-card border-border" : "bg-card/50 border-border/50"}`}>
          <div className="flex items-start justify-between mb-1">
            <h2 className="font-bold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> White-Label Reports
            </h2>
            {!canWhiteLabel && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">
                <Lock className="h-2.5 w-2.5" /> Growth+
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Export Competitor Reports, Marketing Strategy, and Campaign Performance PDFs with your own branding instead of GrowthForge.
          </p>

          {!canWhiteLabel ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300/80">
              Upgrade to the <strong>Growth</strong> plan or higher to unlock white-label PDF exports.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium mb-2 block">Company Name</label>
                <input
                  type="text"
                  value={brandingCompanyName}
                  onChange={e => setBrandingCompanyName(e.target.value)}
                  placeholder="Your Company Name"
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                />
                <p className="text-xs text-muted-foreground mt-1.5">Appears in the PDF header instead of "GrowthForge AI". Leave blank to keep GrowthForge branding.</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Brand Accent Color</label>
                <div className="flex items-center gap-3 flex-wrap">
                  {ACCENT_PRESETS.map(c => (
                    <button
                      key={c}
                      onClick={() => setBrandingAccentColor(c)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all ${brandingAccentColor === c ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100"}`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                  <div className="flex items-center gap-2 ml-1">
                    <input
                      type="color"
                      value={brandingAccentColor}
                      onChange={e => setBrandingAccentColor(e.target.value)}
                      className="w-7 h-7 rounded-lg cursor-pointer border border-border bg-transparent p-0.5"
                      title="Custom color"
                    />
                    <span className="text-xs text-muted-foreground font-mono">{brandingAccentColor}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Used for headings and section dividers in exported PDFs.</p>
              </div>

              {/* Live preview strip */}
              <div className="rounded-xl overflow-hidden border border-border">
                <div className="h-10 flex items-center px-4 gap-3" style={{ backgroundColor: "#040B14" }}>
                  <span className="text-sm font-black" style={{ color: brandingAccentColor }}>
                    {brandingCompanyName.trim() || "Your Company Name"}
                  </span>
                </div>
                <div className="px-4 py-3 bg-secondary/30">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-2 w-24 rounded-full" style={{ backgroundColor: brandingAccentColor, opacity: 0.8 }} />
                    <span className="text-[10px] text-muted-foreground">Section heading</span>
                  </div>
                  <div className="h-1.5 rounded-full mb-2" style={{ backgroundColor: brandingAccentColor, opacity: 0.3, width: "60%" }} />
                  <div className="space-y-1">
                    <div className="h-1.5 bg-white/10 rounded-full w-full" />
                    <div className="h-1.5 bg-white/10 rounded-full w-4/5" />
                    <div className="h-1.5 bg-white/10 rounded-full w-3/5" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveBranding}
                  disabled={updateProject.isPending}
                  className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Branding
                </button>
              </div>
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="p-6 rounded-xl bg-card border border-border">
          <h2 className="font-bold mb-2 flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /> Autonomous Mode</h2>
          <p className="text-sm text-muted-foreground mb-4">When enabled, the AI agent will proactively generate content, optimize campaigns, and run analyses on a schedule — without manual prompts.</p>
          <div className="flex items-center justify-between p-4 rounded-lg bg-secondary border border-border">
            <div>
              <div className="font-medium text-sm">Autonomous AI Mode</div>
              <div className="text-xs text-muted-foreground mt-0.5">{autonomousMode ? "AI is actively managing your marketing" : "Manual mode — you control all actions"}</div>
            </div>
            <button
              onClick={() => setAutonomousMode(!autonomousMode)}
              className={`relative h-6 w-11 rounded-full transition-colors ${autonomousMode ? "bg-primary" : "bg-secondary border border-border"}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${autonomousMode ? "left-6" : "left-1"}`} />
            </button>
          </div>
          {autonomousMode && (
            <div className="mt-3 flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
              <Zap className="h-3.5 w-3.5" /> Autonomous mode is active — AI will run daily marketing tasks automatically
            </div>
          )}
          <div className="flex justify-end mt-5">
            <button
              onClick={handleSave}
              disabled={updateProject.isPending}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="p-6 rounded-xl bg-card border border-border">
          <h2 className="font-bold mb-3">Plan & Usage</h2>
          <div className="flex items-center gap-3">
            <div className="text-sm font-bold capitalize text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg">{project?.plan ?? "starter"}</div>
            <span className="text-sm text-muted-foreground">Current Plan</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
