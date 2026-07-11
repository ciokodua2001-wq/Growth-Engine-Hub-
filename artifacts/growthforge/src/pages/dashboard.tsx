import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useUser, UserButton } from "@clerk/react";
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Globe, Zap, ArrowRight, Loader2, X, Brain, ChevronRight, Crown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";

const statusColor: Record<string, string> = {
  pending: "bg-yellow-400",
  processing: "bg-yellow-400 animate-pulse",
  complete: "bg-primary",
  error: "bg-red-400",
};

const statusLabel: Record<string, string> = {
  pending: "Ready to start",
  processing: "Analyzing...",
  complete: "Active",
  error: "Error",
};

const WORKFLOW_LABELS = [
  "Analysis",
  "Competitors",
  "Strategy",
  "Social",
  "Videos",
  "Campaign",
];

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    createProject.mutate(
      { data: { websiteUrl: url, name: name || url.replace(/^https?:\/\//, "").split("/")[0] } },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project created!", description: "Opening your marketing workflow..." });
          onClose();
          setLocation(`/projects/${project.id}/overview`);
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
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold">New Project</h2>
            <p className="text-sm text-muted-foreground mt-1">Paste your URL to launch your AI marketing OS</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Workflow preview */}
        <div className="my-5 flex items-center gap-1.5 overflow-x-auto pb-1">
          {WORKFLOW_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 bg-secondary px-2 py-1 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                {label}
              </div>
              {i < WORKFLOW_LABELS.length - 1 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
              )}
            </div>
          ))}
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
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">
              Project Name <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
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
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold py-3.5 rounded-xl transition-all mt-2 shadow-lg shadow-primary/20"
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
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const { data: projects, isLoading } = useListProjects();
  const { isAdmin } = useCurrentUser();

  useEffect(() => {
    if (isLoaded && !user) setLocation("/sign-in");
  }, [isLoaded, user, setLocation]);

  // Admins/super admins should never land on the user dashboard — send them to the Admin Console.
  useEffect(() => {
    if (isAdmin) setLocation("/admin", { replace: true });
  }, [isAdmin, setLocation]);

  const firstName = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] ?? "there";

  if (isLoaded && !user) return null;
  if (isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <span className="font-bold text-lg tracking-tight">GrowthForge</span>
          </Link>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/dashboard" className="text-foreground font-medium">Dashboard</Link>
              <Link href="/dashboard" className="hover:text-foreground transition-colors">Projects</Link>
            </nav>
            <UserButton
              appearance={{
                variables: { colorPrimary: "#00E676", colorText: "#ffffff" },
                elements: {
                  userButtonPopoverActionButtonText: { color: "#ffffff" },
                  userButtonPopoverActionButtonIcon: { color: "#ffffff" },
                },
              }}
            />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Page header */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              Hey {firstName} 👋
            </h1>
            <p className="text-muted-foreground mt-1">
              {projects && projects.length > 0
                ? `${projects.length} marketing OS${projects.length === 1 ? "" : "es"} running for you`
                : "Let's build your AI marketing department."}
            </p>
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
                    {/* Card header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Globe className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${statusColor[project.status] ?? "bg-slate-400"}`}
                        />
                        <span className="text-muted-foreground">
                          {statusLabel[project.status] ?? project.status}
                        </span>
                      </div>
                    </div>

                    <h3 className="font-bold text-foreground mb-0.5 group-hover:text-primary transition-colors truncate">
                      {project.name}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mb-5">{project.websiteUrl}</p>

                    {/* 6-step workflow dots */}
                    <div className="mb-4">
                      <div className="flex items-center gap-1 mb-1.5">
                        {WORKFLOW_LABELS.map((label, idx) => (
                          <div
                            key={label}
                            title={label}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              project.status === "complete" && idx === 0
                                ? "bg-primary"
                                : "bg-secondary"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60">
                        {project.status === "complete"
                          ? "Analysis done · Continue workflow →"
                          : "Start your 6-step marketing workflow"}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded">
                        {project.plan ?? "STARTER"}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                        <span>Open</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}

            {/* Add new project card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: projects.length * 0.07 }}
            >
              <button
                onClick={() => setShowModal(true)}
                className="w-full h-full min-h-[220px] group p-6 rounded-2xl border border-dashed border-border hover:border-primary/40 transition-all cursor-pointer hover:bg-primary/3 flex flex-col items-center justify-center gap-3"
              >
                <div className="h-12 w-12 rounded-xl bg-primary/10 group-hover:bg-primary/15 flex items-center justify-center transition-colors">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                    Add New Project
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Paste a URL to start</p>
                </div>
              </button>
            </motion.div>
          </div>
        ) : (
          /* Empty state */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Brain className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Create Your First Project</h2>
            <p className="text-muted-foreground max-w-sm mb-4 leading-relaxed">
              Paste a website URL and GrowthForge AI will guide you through a 6-step marketing workflow to build your complete AI marketing department.
            </p>

            {/* Workflow preview strip */}
            <div className="flex items-center gap-2 mb-8 flex-wrap justify-center">
              {WORKFLOW_LABELS.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary px-3 py-1.5 rounded-full border border-border">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                    {label}
                  </span>
                  {i < WORKFLOW_LABELS.length - 1 && (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6 py-3 rounded-xl transition-colors shadow-lg shadow-primary/20"
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
