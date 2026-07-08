import { useState } from "react";
import { useParams } from "wouter";
import {
  useListAds,
  useGenerateAds,
  useGetProject,
  getListAdsQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Rss, Zap } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const adPlatforms = ["Meta", "Google", "LinkedIn", "TikTok", "YouTube"];

const platformColors: Record<string, string> = {
  Meta: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  Google: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  LinkedIn: "bg-blue-600/15 text-blue-300 border-blue-600/20",
  TikTok: "bg-slate-500/15 text-slate-300 border-slate-500/20",
  YouTube: "bg-rose-500/15 text-rose-400 border-rose-500/20",
};

const ADS_STEPS = [
  "Researching target audience...",
  "Writing high-converting headlines...",
  "Crafting ad copy variations...",
  "Optimizing for platform algorithms...",
  "Predicting performance scores...",
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

export default function ProjectAds() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [selectedPlatform, setSelectedPlatform] = useState("Meta");
  const [modalOpen, setModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: ads, isLoading } = useListAds(projectId, { query: { enabled: !!projectId } });
  const generateAds = useGenerateAds();
  const queryClient = useQueryClient();

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generateAds.mutate(
        { id: projectId, data: { platform: selectedPlatform, count: 4 } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAdsQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Ad Creative Engine</h1>
          <p className="text-muted-foreground mt-1">AI-generated ad creatives with hooks optimized for each platform</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {adPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Zap className="h-4 w-4" />
            Generate Ads
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : ads && ads.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-4">
          {ads.map((ad, i) => {
            const colors = platformColors[ad.platform] ?? "bg-secondary text-muted-foreground border-border";
            return (
              <motion.div
                key={ad.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="p-5 rounded-xl bg-card border border-border"
              >
                <div className="h-32 rounded-lg bg-gradient-to-br from-primary/15 via-secondary to-secondary mb-4 flex flex-col items-center justify-center p-4 text-center">
                  <p className="font-bold text-sm text-foreground mb-1">{ad.headline}</p>
                  {ad.description && <p className="text-xs text-muted-foreground line-clamp-2">{ad.description}</p>}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeof colors === "string" && colors.includes("border") ? colors : "bg-secondary text-muted-foreground border-border"}`}>
                    {ad.platform}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeof colors === "string" ? colors : "bg-secondary text-muted-foreground border-border"}`}>
                    {ad.type}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground capitalize">{ad.status}</span>
                </div>

                {ad.cta && (
                  <div className="mb-3">
                    <span className="text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-lg">{ad.cta}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <ScoreBar label="Hook Strength" value={ad.hookStrength} color="bg-violet-500" />
                  <ScoreBar label="Conversion Potential" value={ad.conversionPotential} color="bg-cyan-500" />
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Rss className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Ad Creatives Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Generate high-converting ad creatives for Meta, Google, LinkedIn, TikTok, and YouTube.</p>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Generate Ads
          </button>
        </div>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Generate ${selectedPlatform} Ad Creatives`}
        subtitle="AI will write 4 high-converting ads optimized for your target platform"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Target startup founders\n• Focus on free trial CTA\n• Emphasize ROI and time savings\n• Use bold direct response copy`}
        processingSteps={ADS_STEPS}
        onSubmit={handleSubmit}
        ctaLabel="Generate Ads"
      />
    </div>
  );
}
