import { useState, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import {
  useListSocialPosts,
  useGenerateSocialPosts,
  useGetContentCalendar,
  useGetProject,
  useGetMetaConnection,
  useDisconnectMeta,
  usePublishSocialPost,
  useGetMetaPages,
  useSelectMetaPage,
  getListSocialPostsQueryKey,
  getGetMetaConnectionQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Share2, Zap, Calendar, Facebook, CheckCircle2, AlertCircle, Link2, Link2Off, Instagram, RefreshCw, ChevronRight } from "lucide-react";
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

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

interface PublishButtonsProps {
  postId: number;
  projectId: number;
  platform: string;
  status: string;
  publishedAt: string | null;
  externalPostId: string | null | undefined;
  hasMetaConnection: boolean;
  hasInstagram: boolean;
  onPublished: (platform: string) => void;
  onError: (msg: string) => void;
}

function PublishButtons({
  postId, projectId, platform, status, publishedAt, hasMetaConnection, hasInstagram, onPublished, onError,
}: PublishButtonsProps) {
  const publishPost = usePublishSocialPost();
  const queryClient = useQueryClient();

  const isMetaPlatform = platform === "facebook" || platform === "instagram";
  const isPublished = status === "published";

  if (!isMetaPlatform || !hasMetaConnection) return null;
  if (platform === "instagram" && !hasInstagram) return null;

  const handlePublish = (targetPlatform: "facebook" | "instagram") => {
    publishPost.mutate(
      { id: projectId, postId, data: { platform: targetPlatform } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSocialPostsQueryKey(projectId) });
          onPublished(targetPlatform);
        },
        onError: () => onError(`Failed to publish to ${targetPlatform}. Check your Meta connection.`),
      }
    );
  };

  if (isPublished) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
        <CheckCircle2 className="h-3 w-3" />
        Published {publishedAt ? new Date(publishedAt).toLocaleDateString() : ""}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {(platform === "facebook" || platform === "instagram") && (
        <button
          onClick={() => handlePublish("facebook")}
          disabled={publishPost.isPending}
          className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-600/15 text-blue-300 border border-blue-600/20 hover:bg-blue-600/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {publishPost.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Facebook className="h-2.5 w-2.5" />}
          Facebook
        </button>
      )}
      {platform === "instagram" && hasInstagram && (
        <button
          onClick={() => handlePublish("instagram")}
          disabled={publishPost.isPending}
          className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-pink-500/15 text-pink-400 border border-pink-500/20 hover:bg-pink-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {publishPost.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Instagram className="h-2.5 w-2.5" />}
          Instagram
        </button>
      )}
    </div>
  );
}

interface PagePickerModalProps {
  token: string;
  projectId: number;
  onSuccess: (pageName: string) => void;
  onCancel: () => void;
}

function PagePickerModal({ token, projectId, onSuccess, onCancel }: PagePickerModalProps) {
  const { data, isLoading, error } = useGetMetaPages({ token }, { query: { retry: false } });
  const selectPage = useSelectMetaPage();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = () => {
    if (!selectedId) return;
    selectPage.mutate(
      { data: { token, pageId: selectedId } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getGetMetaConnectionQueryKey(projectId) });
          onSuccess(result.pageName ?? selectedId);
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <Facebook className="h-4 w-4 text-blue-400" />
            </div>
            <h2 className="text-lg font-bold">Choose a Facebook Page</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            You manage multiple Pages. Select the one you want to connect to this project.
          </p>
        </div>

        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your Pages…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm py-4">
              <AlertCircle className="h-4 w-4 shrink-0" />
              This selection session expired. Please reconnect to choose your Page.
            </div>
          )}

          {data && (
            <div className="space-y-2">
              {data.pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => setSelectedId(page.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                    selectedId === page.id
                      ? "bg-blue-600/15 border-blue-500/40 text-foreground"
                      : "bg-secondary/40 border-border hover:border-blue-500/20 text-foreground"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    selectedId === page.id ? "bg-blue-600/30" : "bg-secondary"
                  }`}>
                    <Facebook className={`h-4 w-4 ${selectedId === page.id ? "text-blue-400" : "text-muted-foreground"}`} />
                  </div>
                  <span className="font-medium text-sm flex-1">{page.name}</span>
                  {selectedId === page.id && <ChevronRight className="h-4 w-4 text-blue-400 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={selectPage.isPending}
            className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground border border-border hover:border-border/80 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSelect}
            disabled={!selectedId || selectPage.isPending || !data}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {selectPage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Connect Page
          </button>
        </div>

        {selectPage.isError && (
          <div className="px-4 pb-4">
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3 shrink-0" />
              Failed to connect the selected page. Please try again.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default function ProjectSocial() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [view, setView] = useState<"posts" | "calendar">("posts");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["linkedin", "instagram", "tiktok"]);
  const [modalOpen, setModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pagePickerToken, setPagePickerToken] = useState<string | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: posts, isLoading } = useListSocialPosts(projectId, { query: { enabled: !!projectId } });
  const { data: calendar } = useGetContentCalendar(projectId, { query: { enabled: !!projectId && view === "calendar" } });
  const { data: metaConn, isLoading: metaLoading } = useGetMetaConnection(projectId, { query: { enabled: !!projectId } });
  const disconnectMeta = useDisconnectMeta();
  const generatePosts = useGenerateSocialPosts();
  const queryClient = useQueryClient();

  // Pick up the meta_pages token from the OAuth redirect URL and open the picker
  useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("meta_pages");
    if (token) {
      setPagePickerToken(token);
      // Remove the param from the URL without a full navigation
      const clean = new URLSearchParams(search);
      clean.delete("meta_pages");
      const newSearch = clean.toString();
      const newPath = `/projects/${projectId}/social${newSearch ? `?${newSearch}` : ""}`;
      history.replaceState(null, "", newPath);
    }
  }, [search, projectId]);

  const showToast = (type: Toast["type"], message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

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

  const handleDisconnect = () => {
    disconnectMeta.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMetaConnectionQueryKey(projectId) });
          showToast("success", "Meta account disconnected.");
        },
        onError: () => showToast("error", "Failed to disconnect. Try again."),
      }
    );
  };

  const handlePagePickerSuccess = (pageName: string) => {
    setPagePickerToken(null);
    showToast("success", `Connected to "${pageName}" successfully!`);
  };

  const handlePagePickerCancel = () => {
    setPagePickerToken(null);
  };

  const filteredPosts = posts?.filter(p => selectedPlatforms.includes(p.platform.toLowerCase())) ?? [];
  const isConnected = metaConn?.connected === true;
  const hasInstagram = isConnected && !!metaConn?.instagramAccountId;

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
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

      {/* Meta connection banner */}
      {!metaLoading && (
        <div className={`mb-6 rounded-xl border p-4 flex items-center gap-4 ${isConnected ? "bg-blue-600/10 border-blue-500/20" : "bg-secondary/50 border-border"}`}>
          <div className="flex items-center gap-2 text-sm flex-1">
            {isConnected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="font-medium text-foreground">{metaConn.pageName}</span>
                <span className="text-muted-foreground text-xs">connected</span>
                {hasInstagram && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-400 border border-pink-500/20">+ Instagram</span>
                )}
              </>
            ) : (
              <>
                <Facebook className="h-4 w-4 text-blue-400 shrink-0" />
                <span className="text-muted-foreground">Connect Facebook &amp; Instagram to publish posts directly</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <a
                  href={`/api/auth/meta/start?projectId=${projectId}`}
                  title="Switch to a different Facebook Page"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-blue-300 border border-border hover:border-blue-500/30 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Switch Page
                </a>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnectMeta.isPending}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-400 border border-border hover:border-red-400/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {disconnectMeta.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2Off className="h-3 w-3" />}
                  Disconnect
                </button>
              </>
            ) : (
              <a
                href={`/api/auth/meta/start?projectId=${projectId}`}
                className="flex items-center gap-1.5 text-xs font-bold bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Link2 className="h-3 w-3" />
                Connect Facebook / Instagram
              </a>
            )}
          </div>
        </div>
      )}

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
                  {post.hashtags && <p className="text-xs text-primary/70 mb-2">{post.hashtags}</p>}
                  {post.cta && <p className="text-xs text-muted-foreground mb-3 italic">{post.cta}</p>}

                  <PublishButtons
                    postId={post.id}
                    projectId={projectId}
                    platform={post.platform.toLowerCase()}
                    status={post.status}
                    publishedAt={post.publishedAt ?? null}
                    externalPostId={post.externalPostId}
                    hasMetaConnection={isConnected}
                    hasInstagram={hasInstagram}
                    onPublished={(p) => showToast("success", `Published to ${p} successfully!`)}
                    onError={(msg) => showToast("error", msg)}
                  />
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <Share2 className="h-16 w-16 text-primary/30 mb-6" />
            <h2 className="text-2xl font-bold mb-3">No Posts Yet</h2>
            <p className="text-muted-foreground mb-8 max-w-sm">Generate social posts across your selected platforms.</p>
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

      {/* Page picker modal (shown after OAuth redirect with multiple pages) */}
      <AnimatePresence>
        {pagePickerToken && (
          <PagePickerModal
            token={pagePickerToken}
            projectId={projectId}
            onSuccess={handlePagePickerSuccess}
            onCancel={handlePagePickerCancel}
          />
        )}
      </AnimatePresence>

      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium max-w-sm pointer-events-auto ${
                toast.type === "success"
                  ? "bg-emerald-950 border-emerald-500/30 text-emerald-300"
                  : "bg-red-950 border-red-500/30 text-red-300"
              }`}
            >
              {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
