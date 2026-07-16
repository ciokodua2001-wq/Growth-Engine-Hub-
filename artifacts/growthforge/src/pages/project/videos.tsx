import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "wouter";
import {
  useListVideos,
  useGenerateVideos,
  useGetProject,
  useStartVideoRender,
  useGetVideoRenderStatus,
  useGenerateImage,
  getListVideosQueryKey,
  getGetVideoRenderStatusQueryKey,
  getGetProjectQueryKey,
  ImageGenerateInputStyle,
  ImageGenerateInputOrientation,
} from "@workspace/api-client-react";
import type { Video as VideoModel, ProjectAvatar } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Video as VideoIcon, Play, Sparkles, Film, Upload, Check, X,
  AlertCircle, ChevronDown, Image as ImageIcon, RefreshCw,
  Lock, Download, ExternalLink, Plus, Trash2, User,
} from "lucide-react";
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

const IMAGE_STEPS = [
  "Reading your brand context...",
  "Crafting the visual prompt...",
  "Generating marketing image...",
  "Finalizing output...",
];

type RenderMode = "footage" | "avatar" | "combined";
type RenderResolution = "1080p" | "4k";

function ScoreBar({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
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

function RenderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle:       { label: "Not Rendered", cls: "bg-white/5 text-white/30 border-white/10" },
    queued:     { label: "Queued",       cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
    processing: { label: "Rendering…",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
    complete:   { label: "Done",         cls: "bg-[#00E676]/15 text-[#00E676] border-[#00E676]/20" },
    failed:     { label: "Failed",       cls: "bg-red-500/15 text-red-400 border-red-500/20" },
  };
  const { label, cls } = map[status] ?? map["idle"];
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

// ── Render Panel (shown inside selected video card) ───────────────────────────
function RenderPanel({
  video,
  projectId,
  isTrial,
  isStarterPlan,
}: {
  video: VideoModel;
  projectId: number;
  isTrial: boolean;
  isStarterPlan: boolean;
}) {
  const [mode, setMode] = useState<RenderMode>("footage");
  const [resolution, setResolution] = useState<RenderResolution>("1080p");

  // Avatar library
  const [avatars, setAvatars] = useState<ProjectAvatar[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Add-avatar inline form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFilePreview, setNewFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const startRender = useStartVideoRender();

  // Poll render status when in progress
  const renderInProgress =
    video.renderStatus === "queued" || video.renderStatus === "processing";

  const { data: renderStatus, refetch: refetchStatus } = useGetVideoRenderStatus(
    projectId,
    video.id,
    {
      query: {
        queryKey: getGetVideoRenderStatusQueryKey(projectId, video.id),
        enabled: renderInProgress,
        refetchInterval: renderInProgress ? 5000 : false,
      },
    }
  );

  const currentStatus = renderStatus?.renderStatus ?? video.renderStatus ?? "idle";
  const currentVideoUrl = renderStatus?.videoUrl ?? video.videoUrl;

  // Load avatar library on mount
  const loadAvatars = useCallback(async () => {
    setAvatarsLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/avatars`);
      if (!res.ok) return;
      const data = await res.json() as { avatars: ProjectAvatar[] };
      setAvatars(data.avatars ?? []);
      if (data.avatars?.length && !selectedAvatarId) {
        const def = data.avatars.find(a => a.isDefault) ?? data.avatars[0];
        if (def) setSelectedAvatarId(def.id);
      }
    } catch {
      // ignore
    } finally {
      setAvatarsLoading(false);
    }
  }, [projectId, selectedAvatarId]);

  useEffect(() => { void loadAvatars(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAvatar = useCallback(async () => {
    if (!newFile) return;
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("photo", newFile);
    form.append("name", newName.trim() || "My Avatar");
    if (newInstructions.trim()) form.append("instructions", newInstructions.trim());
    try {
      const res = await fetch(`/api/projects/${projectId}/avatars`, { method: "POST", body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? "Upload failed");
      }
      const data = await res.json() as { avatar: ProjectAvatar };
      setAvatars(prev => [...prev, data.avatar]);
      setSelectedAvatarId(data.avatar.id);
      setShowAddForm(false);
      setNewName("");
      setNewInstructions("");
      setNewFile(null);
      if (newFilePreview) URL.revokeObjectURL(newFilePreview);
      setNewFilePreview(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [newFile, newName, newInstructions, newFilePreview, projectId]);

  const handleDeleteAvatar = useCallback(async (avatarId: number) => {
    setDeletingId(avatarId);
    try {
      const res = await fetch(`/api/projects/${projectId}/avatars/${avatarId}`, { method: "DELETE" });
      if (res.ok) {
        setAvatars(prev => prev.filter(a => a.id !== avatarId));
        if (selectedAvatarId === avatarId) setSelectedAvatarId(null);
      }
    } finally {
      setDeletingId(null);
    }
  }, [projectId, selectedAvatarId]);

  const handleRender = () => {
    startRender.mutate({
      id: projectId,
      videoId: video.id,
      data: {
        mode,
        resolution,
        ...(selectedAvatarId ? { avatarId: selectedAvatarId } : {}),
      },
    });
  };

  if (isTrial) {
    return (
      <div className="mt-4 pt-4 border-t border-border rounded-xl bg-[#00E676]/5 border border-[#00E676]/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-[#00E676]" />
          <span className="text-sm font-bold text-[#00E676]">Video Rendering — Paid Plans Only</span>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Your trial includes video blueprints (scripts + storyboards). Upgrade to render actual MP4 videos with AI voiceover, MiniMax footage, and Shotstack composition.
        </p>
        <a
          href="/plans"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#00E676] hover:bg-[#00E676]/90 transition-colors"
        >
          <Sparkles className="w-3 h-3" /> Upgrade to Render
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {/* Completed render */}
      {currentStatus === "complete" && currentVideoUrl && (
        <div className="rounded-xl overflow-hidden border border-[#00E676]/30 bg-[#00E676]/5">
          <video controls className="w-full max-h-48 bg-black" src={currentVideoUrl} />
          <div className="flex gap-2 p-3">
            <a
              href={currentVideoUrl}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
            >
              <Download className="w-3 h-3" /> Download
            </a>
            <a
              href={currentVideoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Open
            </a>
          </div>
        </div>
      )}

      {/* Error message */}
      {currentStatus === "failed" && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-400">Render failed</p>
            <p className="text-xs text-white/40 mt-0.5">{video.renderError ?? "An error occurred during rendering. Please try again."}</p>
          </div>
          <button
            onClick={handleRender}
            disabled={startRender.isPending}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 border border-red-500/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" /> Try Again
          </button>
        </div>
      )}

      {/* In-progress indicator */}
      {(currentStatus === "queued" || currentStatus === "processing") && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-400">
              {currentStatus === "queued" ? "Queued for rendering…" : "Rendering your video…"}
            </p>
            <p className="text-xs text-white/40 truncate">ElevenLabs → MiniMax → Shotstack pipeline running</p>
          </div>
          <button
            onClick={() => refetchStatus()}
            className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-white/60 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Render config — only show when not in progress */}
      {currentStatus !== "queued" && currentStatus !== "processing" && (
        <>
          {/* Render mode */}
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Render Mode</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "footage", label: "Footage", desc: "AI b-roll only" },
                { value: "avatar", label: "Presenter", desc: "Talking photo" },
                { value: "combined", label: "Combined", desc: "Presenter over footage" },
              ] as { value: RenderMode; label: string; desc: string }[]).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`p-2 rounded-xl border text-left transition-all ${
                    mode === m.value
                      ? "border-[#00E676]/50 bg-[#00E676]/10"
                      : "border-white/8 hover:border-white/15 bg-white/3"
                  }`}
                >
                  <div className={`text-xs font-bold mb-0.5 ${mode === m.value ? "text-[#00E676]" : "text-white/70"}`}>
                    {m.label}
                  </div>
                  <div className="text-[10px] text-white/35">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Avatar library — shown when mode requires presenter */}
          {(mode === "avatar" || mode === "combined") && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Avatar Library
                </p>
                {!showAddForm && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-[#00E676] hover:bg-[#00E676]/10 transition-colors border border-[#00E676]/20"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                )}
              </div>

              {avatarsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-white/30" />
                </div>
              ) : avatars.length === 0 && !showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full flex flex-col items-center justify-center gap-2 py-5 rounded-xl border border-dashed border-white/15 hover:border-[#00E676]/40 hover:bg-[#00E676]/5 transition-all"
                >
                  <User className="w-5 h-5 text-white/25" />
                  <span className="text-xs text-white/40">Upload your first avatar</span>
                  <span className="text-[10px] text-white/25">Founder, influencer, or brand rep</span>
                </button>
              ) : (
                <div className="space-y-2">
                  {avatars.map((av) => (
                    <button
                      key={av.id}
                      onClick={() => setSelectedAvatarId(av.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left ${
                        selectedAvatarId === av.id
                          ? "border-[#00E676]/50 bg-[#00E676]/8"
                          : "border-white/8 bg-white/3 hover:border-white/15"
                      }`}
                    >
                      <img
                        src={av.photoUrl}
                        alt={av.name}
                        className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/10"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold truncate ${selectedAvatarId === av.id ? "text-[#00E676]" : "text-white/80"}`}>
                          {av.name}
                        </p>
                        {av.instructions ? (
                          <p className="text-[10px] text-white/35 truncate mt-0.5">{av.instructions}</p>
                        ) : (
                          <p className="text-[10px] text-white/20 mt-0.5 italic">No instructions set</p>
                        )}
                      </div>
                      {selectedAvatarId === av.id && (
                        <Check className="w-3.5 h-3.5 text-[#00E676] shrink-0" />
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDeleteAvatar(av.id); }}
                        disabled={deletingId === av.id}
                        className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 disabled:opacity-40"
                        title="Remove avatar"
                      >
                        {deletingId === av.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </button>
                    </button>
                  ))}

                  {!showAddForm && (
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-white/10 hover:border-white/20 text-white/30 hover:text-white/55 transition-all text-xs"
                    >
                      <Plus className="w-3 h-3" /> Add another avatar
                    </button>
                  )}
                </div>
              )}

              {/* Inline add-avatar form */}
              {showAddForm && (
                <div className="mt-2 p-3 rounded-xl border border-white/12 bg-white/3 space-y-3">
                  <p className="text-xs font-bold text-white">New Avatar</p>

                  {/* Photo picker */}
                  {newFilePreview ? (
                    <div className="flex items-center gap-3">
                      <img src={newFilePreview} alt="Preview" className="w-14 h-14 rounded-xl object-cover border border-white/10 shrink-0" />
                      <div>
                        <p className="text-xs text-[#00E676] font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Photo selected
                        </p>
                        <button
                          onClick={() => addFileInputRef.current?.click()}
                          className="text-[10px] text-white/35 hover:text-white/60 transition-colors mt-0.5"
                        >
                          Change photo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => addFileInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border border-dashed border-white/12 hover:border-[#00E676]/40 hover:bg-[#00E676]/5 transition-all"
                    >
                      <Upload className="w-4 h-4 text-white/30" />
                      <span className="text-xs text-white/35">Upload photo</span>
                      <span className="text-[10px] text-white/20">JPEG, PNG, or WebP · max 10 MB</span>
                    </button>
                  )}
                  <input
                    ref={addFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setNewFile(f);
                        if (newFilePreview) URL.revokeObjectURL(newFilePreview);
                        setNewFilePreview(URL.createObjectURL(f));
                      }
                      e.target.value = "";
                    }}
                  />

                  {/* Name */}
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Name — e.g. CEO, Founder, Sarah"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-[#00E676]/40"
                  />

                  {/* Instructions */}
                  <textarea
                    value={newInstructions}
                    onChange={(e) => setNewInstructions(e.target.value)}
                    rows={2}
                    placeholder="Appearance instructions — e.g. Professional presenter, speaking directly to camera, confident and warm"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-[#00E676]/40"
                  />

                  {uploadError && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <X className="w-3 h-3" /> {uploadError}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        setNewFile(null);
                        if (newFilePreview) URL.revokeObjectURL(newFilePreview);
                        setNewFilePreview(null);
                        setNewName("");
                        setNewInstructions("");
                        setUploadError(null);
                      }}
                      className="flex-1 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/70 border border-white/8 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleAddAvatar()}
                      disabled={!newFile || uploading}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-[#00E676] text-black disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    >
                      {uploading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                      ) : (
                        "Save Avatar"
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Prompt when no avatar selected */}
              {(mode === "avatar" || mode === "combined") && !selectedAvatarId && avatars.length > 0 && (
                <p className="text-[10px] text-amber-400/80 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Select an avatar above
                </p>
              )}
            </div>
          )}

          {/* Resolution */}
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Resolution</p>
            <div className="flex gap-2">
              {([
                { value: "1080p", label: "1080p HD", available: true },
                { value: "4k", label: "4K Ultra HD", available: !isStarterPlan },
              ] as { value: RenderResolution; label: string; available: boolean }[]).map((r) => (
                <button
                  key={r.value}
                  onClick={() => r.available && setResolution(r.value)}
                  disabled={!r.available}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    !r.available
                      ? "border-white/5 text-white/20 bg-white/2 cursor-not-allowed"
                      : resolution === r.value
                        ? "border-[#00E676]/50 bg-[#00E676]/10 text-[#00E676]"
                        : "border-white/8 hover:border-white/15 text-white/60"
                  }`}
                >
                  {r.label}
                  {!r.available && <span className="ml-1 text-[9px] text-white/20">(Get-Going+)</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Render button */}
          <button
            onClick={handleRender}
            disabled={
              startRender.isPending ||
              ((mode === "avatar" || mode === "combined") && !selectedAvatarId)
            }
            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#00E676", color: "#040B14" }}
          >
            {startRender.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Starting render…</>
            ) : (
              <><Film className="w-4 h-4" /> Render Video</>
            )}
          </button>

          {startRender.isError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {(startRender.error as { message?: string })?.message ?? "Failed to start render"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── AI Image Studio ───────────────────────────────────────────────────────────
function ImageStudio({ projectId, isTrial }: { projectId: number; isTrial: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageGenerateInputStyle>(ImageGenerateInputStyle.photorealistic);
  const [orientation, setOrientation] = useState<ImageGenerateInputOrientation>(ImageGenerateInputOrientation.landscape);
  const [count, setCount] = useState(1);
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateImage = useGenerateImage();

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const result = await generateImage.mutateAsync({
        id: projectId,
        data: { prompt: prompt || undefined, style, orientation, count },
      });
      setGeneratedUrls((prev) => [...(result.urls ?? []), ...prev]);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error ?? e?.message ?? "Image generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const styles: { value: ImageGenerateInputStyle; label: string }[] = [
    { value: ImageGenerateInputStyle.photorealistic, label: "Photo" },
    { value: ImageGenerateInputStyle.illustration, label: "Illustration" },
    { value: ImageGenerateInputStyle["3d"], label: "3D Render" },
    { value: ImageGenerateInputStyle.minimal, label: "Minimal" },
    { value: ImageGenerateInputStyle.cinematic, label: "Cinematic" },
  ];

  return (
    <div className="mt-10 pt-8 border-t border-border">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-xl bg-[#00D4FF]/15 flex items-center justify-center">
          <ImageIcon className="w-4 h-4 text-[#00D4FF]" />
        </div>
        <div>
          <h2 className="text-lg font-black">AI Image Studio</h2>
          <p className="text-xs text-muted-foreground">Generate marketing visuals grounded in your business</p>
        </div>
        {isTrial && (
          <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/20">
            5 images on trial
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">
              Prompt <span className="normal-case font-normal text-white/30">(leave blank to auto-generate from your brand)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Hero shot of our product on a clean white desk with soft shadows"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-[#00D4FF]/40"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">Style</label>
            <div className="flex flex-wrap gap-1.5">
              {styles.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStyle(s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                    style === s.value
                      ? "border-[#00D4FF]/50 bg-[#00D4FF]/10 text-[#00D4FF]"
                      : "border-white/8 text-white/50 hover:border-white/20"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">Orientation</label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as ImageGenerateInputOrientation)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-sm text-white focus:outline-none"
              >
                <option value={ImageGenerateInputOrientation.landscape}>Landscape</option>
                <option value={ImageGenerateInputOrientation.portrait}>Portrait</option>
                <option value={ImageGenerateInputOrientation.square}>Square</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">
                Count {isTrial && <span className="text-white/25 normal-case font-normal">(max {Math.min(count, 4)})</span>}
              </label>
              <select
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-sm text-white focus:outline-none"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n} image{n > 1 ? "s" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: "#00D4FF", color: "#040B14" }}
          >
            {generating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Generate {count > 1 ? `${count} Images` : "Image"}</>
            )}
          </button>
        </div>

        {/* Generated images gallery */}
        <div>
          {generatedUrls.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {generatedUrls.slice(0, 8).map((url, i) => (
                <div key={`${url}-${i}`} className="relative group rounded-xl overflow-hidden border border-white/8 aspect-video bg-white/3">
                  <img src={url} alt={`Generated ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a
                      href={url}
                      download
                      className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download className="w-3.5 h-3.5 text-white" />
                    </a>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-white" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full min-h-48 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/8 text-center p-6">
              <ImageIcon className="w-10 h-10 text-white/15 mb-3" />
              <p className="text-sm text-white/25">Your generated images appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectVideos() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [mode, setMode] = useState<"auto" | "prompt">("auto");
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const { data: videos, isLoading } = useListVideos(projectId, { query: { queryKey: getListVideosQueryKey(projectId), enabled: !!projectId } });
  const generateVideos = useGenerateVideos();
  const queryClient = useQueryClient();

  const isTrial = project?.plan === "trial";
  const isStarterPlan = project?.plan === "starter";

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

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Video Studio</h1>
          <p className="text-muted-foreground mt-1">
            AI-generated blueprints · Real video rendering · Marketing image generation
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(["auto", "prompt"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "auto" ? "Auto (9 Blueprints)" : "Prompt-Based"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-primary/20"
          >
            <Sparkles className="h-4 w-4" />
            Generate Blueprints
          </button>
        </div>
      </div>

      {/* Blueprint cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : videos && videos.length > 0 ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {videos.map((video, i) => {
            const isSelected = selectedVideo === video.id;
            return (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className={`p-5 rounded-xl bg-card border transition-all ${
                  isSelected ? "border-primary shadow-lg shadow-primary/10" : "border-border hover:border-border/80"
                }`}
              >
                {/* Thumbnail */}
                <div
                  className="h-36 rounded-lg bg-secondary flex items-center justify-center mb-4 relative overflow-hidden group cursor-pointer"
                  onClick={() => setSelectedVideo(isSelected ? null : video.id)}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent" />
                  {video.videoUrl ? (
                    <video
                      src={video.videoUrl}
                      className="absolute inset-0 w-full h-full object-cover"
                      muted
                    />
                  ) : (
                    <Play className="h-10 w-10 text-primary/60 group-hover:text-primary transition-colors" />
                  )}
                  <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded border ${typeColors[video.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
                    {video.type}
                  </span>
                  <div className="absolute bottom-2 left-2">
                    <RenderStatusBadge status={video.renderStatus ?? "idle"} />
                  </div>
                </div>

                {/* Title + meta */}
                <div
                  className="flex items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setSelectedVideo(isSelected ? null : video.id)}
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm leading-snug">{video.title}</h3>
                    {video.duration && (
                      <p className="text-xs text-muted-foreground mt-0.5">{video.duration}s · {video.status}</p>
                    )}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform mt-0.5 ${isSelected ? "rotate-180" : ""}`}
                  />
                </div>

                {/* Score bars */}
                <div className="space-y-2 mt-3">
                  <ScoreBar label="Hook Strength" value={video.hookStrength} color="bg-violet-500" />
                  <ScoreBar label="Engagement" value={video.engagementPotential} color="bg-cyan-500" />
                  <ScoreBar label="Viral Potential" value={video.viralPotential} color="bg-pink-500" />
                </div>

                {/* Expanded content */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      {/* Script + Storyboard */}
                      {video.script && (
                        <div className="mt-4 pt-4 border-t border-border space-y-3">
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Script</div>
                            <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans">{video.script}</pre>
                          </div>
                          {video.storyboard && (
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Storyboard</div>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">{video.storyboard}</pre>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Render panel */}
                      <RenderPanel
                        video={video}
                        projectId={projectId}
                        isTrial={isTrial}
                        isStarterPlan={isStarterPlan}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <VideoIcon className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Blueprints Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Generate video blueprints — scripts, storyboards, and production notes for promos, product demos, and social shorts.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl"
          >
            <Sparkles className="h-4 w-4" />
            Generate {mode === "auto" ? "9 Blueprints" : "3 Blueprints"}
          </button>
        </div>
      )}

      {/* AI Image Studio */}
      <ImageStudio projectId={projectId} isTrial={isTrial} />

      {/* Modals */}
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

      <GenerateModal
        isOpen={imgModalOpen}
        onClose={() => setImgModalOpen(false)}
        title="Generate AI Marketing Images"
        subtitle="AI generates marketing visuals grounded in your brand"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Hero product shot, clean background\n• Social media banner, bold typography\n• Team photo style, warm lighting`}
        processingSteps={IMAGE_STEPS}
        onSubmit={async () => {}}
        ctaLabel="Generate Images"
      />
    </div>
  );
}
