import { useParams } from "wouter";
import {
  useGetProject,
  useUpdateProject,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings, Globe, Zap, Bot, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

export default function ProjectSettings() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: project, isLoading } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [autonomousMode, setAutonomousMode] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setWebsiteUrl(project.websiteUrl);
      setAutonomousMode(project.autonomousMode);
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

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-8 max-w-2xl">
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
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="p-6 rounded-xl bg-card border border-border">
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
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="p-6 rounded-xl bg-card border border-border">
          <h2 className="font-bold mb-3">Plan & Usage</h2>
          <div className="flex items-center gap-3">
            <div className="text-sm font-bold capitalize text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg">{project?.plan ?? "starter"}</div>
            <span className="text-sm text-muted-foreground">Current Plan</span>
          </div>
        </motion.div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={updateProject.isPending}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-6 py-3 rounded-xl transition-colors"
          >
            {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
