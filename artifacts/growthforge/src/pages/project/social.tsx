import { useState } from "react";
import { useParams } from "wouter";
import {
  useListSocialPosts,
  useGenerateSocialPosts,
  useGetContentCalendar,
  useGetProject,
  getListSocialPostsQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Share2, Zap, Calendar } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const platforms = ["linkedin", "instagram", "tiktok", "x", "facebook"];

const platformColors: Record<string, { bg: string; text: string; border: string }> = {
  linkedin: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/20" },
  instagram: { bg: "bg-pink-500/15", text: "text-pink-400", border: "border-pink-500/20" },
  tiktok: { bg: "bg-slate-500/15", text: "text-slate-300", border: "border-slate-500/20" },
  x: { bg: "bg-slate-600/15", text: "text-slate-400", border: "border-slate-600/20" },
  facebook: { bg: "bg-blue-600/15", text: "text-blue-300", border: "border-blue-600/20" },
};

const SOCIAL_STEPS = [
  "Analyzing platform trends...",
  "Crafting platform-native hooks...",
  "Writing engaging captions...",
  "Adding hashtag strategy...",
  "Scheduling content calendar...",
];

export default function ProjectSocial() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [view, setView] = useState<"posts" | "calendar">("posts");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["linkedin", "instagram", "tiktok"]);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: posts, isLoading } = useListSocialPosts(projectId, { query: { enabled: !!projectId } });
  const { data: calendar } = useGetContentCalendar(projectId, { query: { enabled: !!projectId && view === "calendar" } });
  const generatePosts = useGenerateSocialPosts();
  const queryClient = useQueryClient();

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generatePosts.mutate(
        { id: projectId, data: { platforms: selectedPlatforms } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSocialPostsQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  const filteredPosts = posts?.filter(p => selectedPlatforms.includes(p.platform.toLowerCase())) ?? [];

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Social Media Hub</h1>
          <p className="text-muted-foreground mt-1">Platform-optimized posts and content calendar</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={selectedPlatforms.length === 0}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
        >
          <Zap className="h-4 w-4" />
          Generate Posts
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {platforms.map(p => {
          const colors = platformColors[p] ?? { bg: "bg-secondary", text: "text-muted-foreground", border: "border-border" };
          const active = selectedPlatforms.includes(p);
          return (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all capitalize ${active ? `${colors.bg} ${colors.text} ${colors.border}` : "bg-secondary/50 text-muted-foreground border-border"}`}
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="flex gap-1 mb-6 bg-secondary rounded-xl p-1 w-fit">
        {([["posts", "Posts"], ["calendar", "Calendar"]] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {v === "calendar" && <Calendar className="h-3.5 w-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : view === "posts" ? (
        filteredPosts.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-4">
            {filteredPosts.map((post, i) => {
              const colors = platformColors[post.platform.toLowerCase()] ?? { bg: "bg-secondary", text: "text-muted-foreground", border: "border-border" };
              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="p-5 rounded-xl bg-card border border-border"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded border capitalize ${colors.bg} ${colors.text} ${colors.border}`}>
                      {post.platform}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto capitalize">{post.status}</span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed mb-3">{post.caption}</p>
                  {post.hashtags && <p className="text-xs text-primary/70">{post.hashtags}</p>}
                  {post.cta && <p className="text-xs text-muted-foreground mt-2 italic">{post.cta}</p>}
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <Share2 className="h-16 w-16 text-primary/30 mb-6" />
            <h2 className="text-2xl font-bold mb-3">No Posts Yet</h2>
            <p className="text-muted-foreground mb-8 max-w-sm">Generate 30 days of social content across your selected platforms.</p>
            <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
              <Zap className="h-4 w-4" /> Generate Posts
            </button>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {calendar && (calendar as Array<{ date: string; posts: typeof posts }>).slice(0, 14).map((day) => (
            <div key={day.date} className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-secondary/50">
                <span className="text-sm font-bold">{new Date(day.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span>
                <span className="text-xs text-muted-foreground ml-2">{Array.isArray(day.posts) ? day.posts.length : 0} posts</span>
              </div>
              <div className="divide-y divide-border">
                {Array.isArray(day.posts) && day.posts.map((post: { id: number; platform: string; caption: string }) => {
                  const colors = platformColors[post.platform.toLowerCase()] ?? { bg: "bg-secondary", text: "text-muted-foreground", border: "border-border" };
                  return (
                    <div key={post.id} className="px-4 py-3 flex items-start gap-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 capitalize mt-0.5 ${colors.bg} ${colors.text} ${colors.border}`}>{post.platform}</span>
                      <p className="text-xs text-muted-foreground line-clamp-2">{post.caption}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {(!calendar || (calendar as unknown[]).length === 0) && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              Generate social posts to populate your content calendar.
            </div>
          )}
        </div>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Generate Social Posts"
        subtitle={`Creating content for ${selectedPlatforms.join(", ")}`}
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Generate LinkedIn thought leadership\n• Create viral TikTok hooks\n• Focus on product launches\n• Target startup founders`}
        processingSteps={SOCIAL_STEPS}
        onSubmit={handleSubmit}
        ctaLabel="Generate Posts"
      />
    </div>
  );
}
