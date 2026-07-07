import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Globe, Zap, ArrowRight, Loader2, X, Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusColor: Record<string, string> = {
  pending: "bg-slate-400",
  processing: "bg-yellow-400",
  complete: "bg-green-400",
  error: "bg-red-400",
};

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    createProject.mutate(
      { data: { websiteUrl: url, name: name || url.replace(/^https?:\/\//, "").split("/")[0] } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project created!", description: "Your AI marketing department is being set up." });
          onClose();
        },
        onError: () => {
          toast({ title: "Error", description: "Could not create project. Try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-card border border-border rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">New Project</h2>
            <p className="text-sm text-muted-foreground mt-1">Paste your URL to get your AI marketing department</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Website URL</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourwebsite.com"
                className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Project Name <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Startup Marketing"
              className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={createProject.isPending || !url}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold py-3.5 rounded-xl transition-all mt-2"
          >
            {createProject.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Creating Project...</>
            ) : (
              <><Brain className="h-4 w-4" /> Start AI Analysis</>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export default function DashboardPage() {
  const [showModal, setShowModal] = useState(false);
  const { data: projects, isLoading } = useListProjects();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <span className="font-bold text-lg tracking-tight">GrowthForge AI</span>
          </div>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Back to Home</Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Your Projects</h1>
            <p className="text-muted-foreground mt-1">Each project is a full AI marketing department for one business.</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl transition-colors shadow-lg shadow-primary/20"
          >
            <Plus className="h-4 w-4" />
            New Project
          </motion.button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
              >
                <Link href={`/projects/${project.id}/overview`}>
                  <div className="group p-6 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all cursor-pointer hover:shadow-lg hover:shadow-primary/5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Globe className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${statusColor[project.status] ?? "bg-slate-400"}`} />
                        <span className="text-xs text-muted-foreground capitalize">{project.status}</span>
                      </div>
                    </div>

                    <h3 className="font-bold text-foreground mb-1 group-hover:text-primary transition-colors truncate">
                      {project.name}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mb-4">{project.websiteUrl}</p>

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded">
                        {project.plan}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-32 text-center"
          >
            <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Brain className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Create Your First Project</h2>
            <p className="text-muted-foreground max-w-sm mb-8 leading-relaxed">
              Paste a website URL and your AI marketing department will be ready in minutes.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6 py-3 rounded-xl transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create New Project
            </button>
          </motion.div>
        )}
      </div>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
