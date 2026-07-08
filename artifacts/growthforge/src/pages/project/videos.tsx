import { useState } from "react";
import { useParams } from "wouter";
import {
  useListVideos,
  useGenerateVideos,
  useGetProject,
  getListVideosQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Video, Play, Sparkles } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const typeColors: Record<string, string> = {
  promo: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  product: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  social: "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

const VIDEO_STEPS = [
  "Analyzing brand story...",
  "Writing video scripts...",
  "Creating storyboards...",
  "Optimizing hooks for virality...",
  "Finalizing video production pack...",
];

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold">{value ?? 0}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
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

export default function ProjectVideos() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [mode, setMode] = useState<"auto" | "prompt">("auto");
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: videos, isLoading } = useListVideos(projectId, { query: { enabled: !!projectId } });
  const generateVideos = useGenerateVideos();
  const queryClient = useQueryClient();

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generateVideos.mutate(
        { id: projectId, data: { mode, count: mode === "auto" ? 9 : 3 } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListVideosQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  const selectedVideoData = selectedVideo !== null ? videos?.find(v => v.id === selectedVideo) : null;
  void selectedVideoData;

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Video Studio</h1>
          <p className="text-muted-foreground mt-1">AI-generated marketing videos with scripts and storyboards</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(["auto", "prompt"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "auto" ? "Auto (9 Videos)" : "Prompt-Based"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-primary/20"
          >
            <Sparkles className="h-4 w-4" />
            Generate Videos
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : videos && videos.length > 0 ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {videos.map((video, i) => (
            <motion.div
              key={video.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className={`p-5 rounded-xl bg-card border cursor-pointer transition-all ${selectedVideo === video.id ? "border-primary shadow-lg shadow-primary/10" : "border-border hover:border-border/80"}`}
              onClick={() => setSelectedVideo(selectedVideo === video.id ? null : video.id)}
            >
              <div className="h-36 rounded-lg bg-secondary flex items-center justify-center mb-4 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent" />
                <Play className="h-10 w-10 text-primary/60 group-hover:text-primary transition-colors" />
                <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded border ${typeColors[video.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
                  {video.type}
                </span>
              </div>

              <h3 className="font-bold mb-1 text-sm leading-snug">{video.title}</h3>
              {video.duration && <p className="text-xs text-muted-foreground mb-3">{video.duration}s · {video.status}</p>}

              <div className="space-y-2">
                <ScoreBar label="Hook Strength" value={video.hookStrength} color="bg-violet-500" />
                <ScoreBar label="Engagement" value={video.engagementPotential} color="bg-cyan-500" />
                <ScoreBar label="Viral Potential" value={video.viralPotential} color="bg-pink-500" />
              </div>

              {selectedVideo === video.id && video.script && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 pt-4 border-t border-border">
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Script</div>
                    <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans">{video.script}</pre>
                  </div>
                  {video.storyboard && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Storyboard</div>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">{video.storyboard}</pre>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Video className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Videos Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Generate 9 professional marketing videos — promos, product demos, and social shorts — with one click.</p>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Sparkles className="h-4 w-4" />
            Generate {mode === "auto" ? "9 Videos" : "3 Videos"}
          </button>
        </div>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Generate ${mode === "auto" ? "9 Marketing Videos" : "Prompt-Based Videos"}`}
        subtitle="AI will write scripts, storyboards, and production notes for each video"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on product demo videos\n• Create viral TikTok hooks\n• Target founder pain points\n• Include customer testimonial style`}
        processingSteps={VIDEO_STEPS}
        onSubmit={handleSubmit}
        ctaLabel={`Generate ${mode === "auto" ? "9 Videos" : "3 Videos"}`}
      />
    </div>
  );
}
