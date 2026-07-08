import { useState } from "react";
import { useParams } from "wouter";
import {
  useListContent,
  useGenerateContent,
  useDeleteContent,
  useGetProject,
  getListContentQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, FileText, Zap, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import GenerateModal from "@/components/ui/generate-modal";

const typeOptions = ["blog", "whitepaper", "case-study", "landing-page", "email-sequence", "press-release"];

const typeColors: Record<string, string> = {
  blog: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  whitepaper: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  "case-study": "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "landing-page": "bg-orange-500/15 text-orange-400 border-orange-500/20",
};

const CONTENT_STEPS = [
  "Analyzing your brand voice...",
  "Researching topic angles...",
  "Writing content structure...",
  "Crafting headlines and hooks...",
  "Optimizing for conversion...",
];

function ScoreBar({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-bold">{value ?? 0}</span>
      </div>
      <div className="h-1 bg-secondary rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value ?? 0}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
}

export default function ProjectContent() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [selectedType, setSelectedType] = useState("blog");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: content, isLoading } = useListContent(projectId, { query: { enabled: !!projectId } });
  const generateContent = useGenerateContent();
  const deleteContent = useDeleteContent();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generateContent.mutate(
        { id: projectId, data: { type: selectedType, count: 3 } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListContentQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  const handleDelete = (contentId: number) => {
    deleteContent.mutate(
      { id: projectId, contentId },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListContentQueryKey(projectId) }),
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Content Engine</h1>
          <p className="text-muted-foreground mt-1">AI-generated content tailored to your brand voice and ICP</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {typeOptions.map((t) => <option key={t} value={t}>{t.replace(/-/g, " ")}</option>)}
          </select>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Zap className="h-4 w-4" />
            Generate Content
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : content && content.length > 0 ? (
        <div className="space-y-3">
          {content.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-xl bg-card border border-border overflow-hidden"
            >
              <div className="p-5 flex items-start gap-4">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-sm leading-snug">{item.title}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeColors[item.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
                      {item.type}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-3">
                    <ScoreBar label="Hook" value={item.hookStrength} color="bg-violet-500" />
                    <ScoreBar label="Conversion" value={item.conversionPotential} color="bg-cyan-500" />
                    <ScoreBar label="Engagement" value={item.engagementPotential} color="bg-emerald-500" />
                    <ScoreBar label="Viral" value={item.viralPotential} color="bg-pink-500" />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {expandedId === item.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-2 rounded-lg hover:bg-destructive/20 transition-colors text-muted-foreground hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {expandedId === item.id && item.body && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border-t border-border px-5 py-4"
                >
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans max-h-80 overflow-y-auto">{item.body}</pre>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <FileText className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Content Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Generate SEO-optimized blog posts, whitepapers, case studies, and more.</p>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Generate Content
          </button>
        </div>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Generate ${selectedType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`}
        subtitle="AI will write high-converting content tailored to your audience"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on SEO keyword clusters\n• Write for technical audiences\n• Include case study examples\n• Target early-stage founders`}
        processingSteps={CONTENT_STEPS}
        onSubmit={handleSubmit}
        ctaLabel="Generate Content"
      />
    </div>
  );
}
