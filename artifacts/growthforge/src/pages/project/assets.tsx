import { useParams } from "wouter";
import { useListAssets } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Loader2, FolderOpen, Video, Image, FileText, Mail, Rss } from "lucide-react";

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  video: Video,
  image: Image,
  document: FileText,
  email: Mail,
  ad: Rss,
};

const typeColors: Record<string, string> = {
  video: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  image: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  document: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  email: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  ad: "bg-orange-500/15 text-orange-400 border-orange-500/20",
};

export default function ProjectAssets() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: assets, isLoading } = useListAssets(projectId, { query: { enabled: !!projectId } });

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">Asset Library</h1>
        <p className="text-muted-foreground mt-1">All your generated marketing assets in one place</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : assets && assets.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets.map((asset, i) => {
            const Icon = typeIcons[asset.type] ?? FileText;
            const colors = typeColors[asset.type] ?? "bg-secondary text-muted-foreground border-border";
            return (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="p-4 rounded-xl bg-card border border-border hover:border-border/60 transition-colors group"
              >
                <div className="h-32 rounded-lg bg-secondary flex items-center justify-center mb-3">
                  <Icon className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${colors}`}>{asset.type}</span>
                  <span className="text-xs text-foreground font-medium truncate flex-1">{asset.name}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <FolderOpen className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">Asset Library is Empty</h2>
          <p className="text-muted-foreground max-w-sm">
            Generate content, videos, ads, and emails in other sections — they'll all appear here for easy management.
          </p>
        </div>
      )}
    </div>
  );
}
