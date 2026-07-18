import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Image as ImageIcon, Upload, Trash2, Pencil, X, Check,
  Loader2, AlertCircle, Users, Eye, EyeOff, Sparkles,
  CheckCircle2, XCircle, CloudUpload, RefreshCw,
} from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

interface PlatformAvatar {
  id: number;
  name: string;
  gender: string;
  archetype: string;
  previewUrl: string;
  heygenTalkingPhotoId: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

interface BulkResult {
  filename: string;
  success: boolean;
  avatar?: PlatformAvatar;
  error?: string;
}

const GENDERS = ["male", "female", "neutral"] as const;
const ARCHETYPES = ["presenter", "founder", "exec", "creative", "casual", "educator", "influencer", "professional"] as const;

const GENDER_COLORS: Record<string, string> = {
  male: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  female: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  neutral: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

const ARCHETYPE_COLORS: Record<string, string> = {
  presenter: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  founder: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  exec: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  creative: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  casual: "bg-green-500/20 text-green-300 border-green-500/30",
  educator: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  influencer: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  professional: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
};

function badge(label: string, colorClass: string) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${colorClass}`}>
      {label}
    </span>
  );
}

interface SyncResult {
  synced: number;
  total: number;
  results: Array<{ id: number; name: string; ok: boolean; error?: string }>;
  message?: string;
}

export default function AdminAvatarLibrary() {
  const queryClient = useQueryClient();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [filterGender, setFilterGender] = useState<string>("all");
  const [filterArchetype, setFilterArchetype] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/platform-avatars/sync-heygen", { method: "POST" });
      const body = await res.json() as SyncResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      return body;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      queryClient.invalidateQueries({ queryKey: ["admin-platform-avatars"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Sync failed"),
  });

  const resetIdsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/platform-avatars/clear-heygen-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json() as { ok: boolean; cleared: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Reset failed");
      return body;
    },
    onSuccess: (data) => {
      setShowResetConfirm(false);
      setSyncResult({ synced: 0, total: data.cleared, results: [], message: `Cleared ${data.cleared} stale HeyGen IDs — now click Sync HeyGen to re-upload.` });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-avatars"] });
    },
    onError: (err) => { setShowResetConfirm(false); setError(err instanceof Error ? err.message : "Reset failed"); },
  });

  const { data, isLoading } = useQuery<{ avatars: PlatformAvatar[] }>({
    queryKey: ["admin-platform-avatars"],
    queryFn: async () => {
      const res = await fetch("/api/admin/platform-avatars");
      if (!res.ok) throw new Error("Failed to load avatars");
      return res.json() as Promise<{ avatars: PlatformAvatar[] }>;
    },
  });

  const avatars = data?.avatars ?? [];
  const filtered = avatars.filter((a) => {
    if (filterGender !== "all" && a.gender !== filterGender) return false;
    if (filterArchetype !== "all" && a.archetype !== filterArchetype) return false;
    return true;
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await fetch(`/api/admin/platform-avatars/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-platform-avatars"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/platform-avatars/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-platform-avatars"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  const activeCount = avatars.filter((a) => a.isActive).length;

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5" style={{ color: "#00E676" }} />
              <h1 className="text-xl font-bold text-white">Avatar Library</h1>
            </div>
            <p className="text-sm text-white/40">
              Platform-wide presenter avatars. AI auto-classifies gender, archetype & name on upload.
              <span className="ml-2 text-white/60">{activeCount} active · {avatars.length} total</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showResetConfirm ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/40 bg-red-500/10">
                <span className="text-xs text-red-300 font-semibold">Clear all HeyGen IDs?</span>
                <button
                  onClick={() => resetIdsMutation.mutate()}
                  disabled={resetIdsMutation.isPending}
                  className="px-2 py-0.5 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-red-200 text-xs font-bold transition-colors disabled:opacity-40"
                >
                  {resetIdsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Yes, clear"}
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="text-white/40 hover:text-white/70"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setSyncResult(null); setError(null); setShowResetConfirm(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-white/10 text-white/40 hover:text-red-300 hover:border-red-500/30 transition-colors"
                title="Use after manually deleting talking photos from HeyGen dashboard — marks all IDs as stale so Sync re-uploads them"
              >
                Reset IDs
              </button>
            )}
            <button
              onClick={() => { setSyncResult(null); setError(null); syncMutation.mutate(); }}
              disabled={syncMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors disabled:opacity-40"
              title="Upload all avatars missing HeyGen talking photo IDs — run after Reset IDs"
            >
              {syncMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              Sync HeyGen
            </button>
            <button
              onClick={() => { setShowUploadModal(true); setError(null); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-black"
              style={{ background: "#00E676" }}
            >
              <CloudUpload className="w-4 h-4" /> Bulk Upload
            </button>
          </div>
        </div>

        {syncResult && (
          <div className={`flex items-start gap-3 p-3 rounded-xl border mb-4 ${
            syncResult.synced === syncResult.total || syncResult.synced > 0
              ? "bg-[#00E676]/8 border-[#00E676]/20"
              : "bg-yellow-500/8 border-yellow-500/20"
          }`}>
            {syncResult.synced > 0
              ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#00E676" }} />
              : <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-semibold">
                {syncResult.message ?? `Synced ${syncResult.synced} of ${syncResult.total} avatars to HeyGen`}
              </p>
              {syncResult.results?.filter(r => !r.ok).map(r => (
                <p key={r.id} className="text-xs text-red-400 mt-0.5">{r.name}: {r.error}</p>
              ))}
            </div>
            <button onClick={() => setSyncResult(null)} className="text-white/30 hover:text-white/60">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white/5 rounded-lg px-1 py-1">
            {["all", ...GENDERS].map((g) => (
              <button
                key={g}
                onClick={() => setFilterGender(g)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  filterGender === g ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {g === "all" ? "All genders" : g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 rounded-lg px-1 py-1 flex-wrap">
            {["all", ...ARCHETYPES].map((a) => (
              <button
                key={a}
                onClick={() => setFilterArchetype(a)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  filterArchetype === a ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {a === "all" ? "All archetypes" : a.charAt(0).toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <ImageIcon className="w-10 h-10 text-white/10" />
            <p className="text-white/30 text-sm">
              {avatars.length === 0
                ? 'No avatars yet. Click "Bulk Upload" to add photos — AI will auto-categorize them.'
                : "No avatars match the current filters."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filtered.map((avatar) => (
              <AvatarCard
                key={avatar.id}
                avatar={avatar}
                isEditing={editingId === avatar.id}
                isDeleting={deleteConfirmId === avatar.id}
                onEdit={() => setEditingId(avatar.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  queryClient.invalidateQueries({ queryKey: ["admin-platform-avatars"] });
                }}
                onToggleActive={() => toggleActiveMutation.mutate({ id: avatar.id, isActive: !avatar.isActive })}
                onDeleteRequest={() => setDeleteConfirmId(avatar.id)}
                onDeleteCancel={() => setDeleteConfirmId(null)}
                onDeleteConfirm={() => deleteMutation.mutate(avatar.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showUploadModal && (
        <BulkUploadModal
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => {
            setShowUploadModal(false);
            queryClient.invalidateQueries({ queryKey: ["admin-platform-avatars"] });
          }}
        />
      )}
    </AdminLayout>
  );
}

// ── Avatar card ────────────────────────────────────────────────────────────────

function AvatarCard({
  avatar, isEditing, isDeleting, onEdit, onCancelEdit, onSaved,
  onToggleActive, onDeleteRequest, onDeleteCancel, onDeleteConfirm,
}: {
  avatar: PlatformAvatar;
  isEditing: boolean;
  isDeleting: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onToggleActive: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const [editName, setEditName] = useState(avatar.name);
  const [editGender, setEditGender] = useState(avatar.gender);
  const [editArchetype, setEditArchetype] = useState(avatar.archetype);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/platform-avatars/${avatar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, gender: editGender, archetype: editArchetype }),
      });
      if (!res.ok) throw new Error("Failed to save");
      onSaved();
    } catch {
      setSaveError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
        <div className="aspect-square overflow-hidden bg-white/5">
          <img src={avatar.previewUrl} alt={avatar.name} className="w-full h-full object-cover" />
        </div>
        <div className="p-2 space-y-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full bg-white/8 border border-white/15 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#00E676]/50"
            placeholder="Name"
          />
          <select
            value={editGender}
            onChange={(e) => setEditGender(e.target.value)}
            className="w-full bg-white/8 border border-white/15 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
          >
            {GENDERS.map((g) => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
          </select>
          <select
            value={editArchetype}
            onChange={(e) => setEditArchetype(e.target.value)}
            className="w-full bg-white/8 border border-white/15 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
          >
            {ARCHETYPES.map((a) => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
          </select>
          {saveError && <p className="text-[10px] text-red-400">{saveError}</p>}
          <div className="flex gap-1">
            <button
              onClick={handleSave}
              disabled={saving || !editName.trim()}
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-[#00E676]/20 text-[#00E676] hover:bg-[#00E676]/30 text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
            </button>
            <button
              onClick={onCancelEdit}
              className="flex-1 flex items-center justify-center py-1 rounded-lg bg-white/8 text-white/50 hover:text-white text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isDeleting) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl overflow-hidden flex flex-col">
        <div className="aspect-square overflow-hidden bg-white/5 relative">
          <img src={avatar.previewUrl} alt={avatar.name} className="w-full h-full object-cover opacity-40" />
        </div>
        <div className="p-2 space-y-1.5">
          <p className="text-xs text-red-300 font-semibold text-center">Delete &quot;{avatar.name}&quot;?</p>
          <p className="text-[10px] text-white/40 text-center">This can&apos;t be undone.</p>
          <div className="flex gap-1">
            <button
              onClick={onDeleteConfirm}
              className="flex-1 py-1 rounded-lg bg-red-500/30 text-red-300 hover:bg-red-500/40 text-xs font-semibold transition-colors"
            >
              Delete
            </button>
            <button
              onClick={onDeleteCancel}
              className="flex-1 py-1 rounded-lg bg-white/8 text-white/50 hover:text-white text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`group relative bg-white/5 border rounded-2xl overflow-hidden flex flex-col transition-all ${
      avatar.isActive ? "border-white/10 hover:border-white/20" : "border-white/5 opacity-50"
    }`}>
      <div className="aspect-square overflow-hidden bg-white/5 relative">
        <img src={avatar.previewUrl} alt={avatar.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button onClick={onEdit} className="p-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onToggleActive} className="p-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors" title={avatar.isActive ? "Deactivate" : "Activate"}>
            {avatar.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onDeleteRequest} className="p-2 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-red-300 transition-colors" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {avatar.heygenTalkingPhotoId && (
          <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#00E676]" title="HeyGen talking photo cached" />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-white truncate mb-1.5" title={avatar.name}>{avatar.name}</p>
        <div className="flex flex-wrap gap-1">
          {badge(avatar.gender, GENDER_COLORS[avatar.gender] ?? GENDER_COLORS.neutral)}
          {badge(avatar.archetype, ARCHETYPE_COLORS[avatar.archetype] ?? ARCHETYPE_COLORS.presenter)}
        </div>
      </div>
    </div>
  );
}

// ── Bulk upload modal ─────────────────────────────────────────────────────────

type UploadPhase = "select" | "uploading" | "done";

interface QueuedFile {
  id: string;
  file: File;
  previewUrl: string;
}

function BulkUploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [phase, setPhase] = useState<UploadPhase>("select");
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter((f) =>
      ["image/jpeg", "image/png", "image/webp"].includes(f.type) && f.size <= 15 * 1024 * 1024
    );
    setQueue((prev) => {
      const existingNames = new Set(prev.map((q) => q.file.name));
      const fresh = valid
        .filter((f) => !existingNames.has(f.name))
        .map((f) => ({
          id: `${f.name}-${f.size}`,
          file: f,
          previewUrl: URL.createObjectURL(f),
        }));
      return [...prev, ...fresh];
    });
    const skipped = incoming.length - valid.length;
    if (skipped > 0) {
      setError(`${skipped} file${skipped > 1 ? "s" : ""} skipped — must be JPEG/PNG/WebP under 15 MB.`);
    } else {
      setError(null);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles],
  );

  const removeFile = (id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  };

  const handleUpload = async () => {
    if (queue.length === 0) return;
    setPhase("uploading");
    setError(null);

    try {
      const formData = new FormData();
      for (const item of queue) {
        formData.append("photos", item.file);
      }

      const res = await fetch("/api/admin/platform-avatars/bulk", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }

      const data = await res.json() as { results: BulkResult[]; successCount: number; totalCount: number };
      setResults(data.results);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setPhase("select");
    }
  };

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  // ── Done screen ──────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
        <div className="w-full max-w-lg bg-[#0A1628] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
            <h2 className="font-bold text-white">Upload Complete</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Summary */}
            <div className="flex gap-3">
              {successCount > 0 && (
                <div className="flex-1 flex items-center gap-2.5 p-3 rounded-xl bg-[#00E676]/10 border border-[#00E676]/20">
                  <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: "#00E676" }} />
                  <div>
                    <p className="text-sm font-bold text-white">{successCount} uploaded</p>
                    <p className="text-xs text-white/40">AI-classified & saved</p>
                  </div>
                </div>
              )}
              {failCount > 0 && (
                <div className="flex-1 flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-white">{failCount} failed</p>
                    <p className="text-xs text-white/40">See details below</p>
                  </div>
                </div>
              )}
            </div>

            {/* Failed list */}
            {failCount > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {results.filter((r) => !r.success).map((r) => (
                  <div key={r.filename} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15">
                    <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-white/70 font-medium truncate">{r.filename}</p>
                      <p className="text-[10px] text-red-400">{r.error}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Successful avatars preview */}
            {successCount > 0 && (
              <div className="grid grid-cols-6 gap-1.5">
                {results.filter((r) => r.success && r.avatar).slice(0, 12).map((r) => (
                  <div key={r.avatar!.id} className="aspect-square rounded-lg overflow-hidden bg-white/5">
                    <img src={r.avatar!.previewUrl} alt={r.avatar!.name} className="w-full h-full object-cover" />
                  </div>
                ))}
                {successCount > 12 && (
                  <div className="aspect-square rounded-lg bg-white/8 flex items-center justify-center">
                    <span className="text-xs text-white/40 font-semibold">+{successCount - 12}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-white/8">
            <button
              onClick={onUploaded}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-black"
              style={{ background: "#00E676" }}
            >
              Done — View Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Uploading screen ─────────────────────────────────────────────────────────
  if (phase === "uploading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
        <div className="w-full max-w-sm bg-[#0A1628] border border-white/10 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 text-center">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-[#00E676]/20" />
            <div className="absolute inset-0 rounded-full border-t-2 border-[#00E676] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-6 h-6" style={{ color: "#00E676" }} />
            </div>
          </div>
          <div>
            <p className="font-bold text-white text-lg">Analyzing with AI</p>
            <p className="text-sm text-white/50 mt-1">
              Running vision analysis on {queue.length} photo{queue.length !== 1 ? "s" : ""}
              <br />to detect gender, archetype & name…
            </p>
          </div>
          <p className="text-xs text-white/25">
            ~{Math.ceil(queue.length / 5) * 3}s estimated · please don&apos;t close this tab
          </p>
        </div>
      </div>
    );
  }

  // ── Select screen ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
      <div className="w-full max-w-2xl bg-[#0A1628] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
          <div>
            <h2 className="font-bold text-white">Bulk Upload Avatars</h2>
            <p className="text-xs text-white/40 mt-0.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" style={{ color: "#00E676" }} />
              AI will auto-detect gender, archetype & name from each photo
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-all py-8 ${
              dragging
                ? "border-[#00E676] bg-[#00E676]/5"
                : "border-white/15 hover:border-white/30 bg-white/3"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-white/8">
              <Upload className="w-5 h-5 text-white/50" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white/70">Drag & drop photos here, or click to browse</p>
              <p className="text-xs text-white/30 mt-0.5">JPEG · PNG · WebP · max 15 MB each · up to 50 photos</p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Queue list */}
          {queue.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-white/60">
                  {queue.length} photo{queue.length !== 1 ? "s" : ""} queued
                </p>
                <button
                  onClick={() => {
                    queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
                    setQueue([]);
                  }}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  Clear all
                </button>
              </div>

              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/4 border border-white/8 group"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 shrink-0">
                      <img src={item.previewUrl} alt={item.file.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{item.file.name}</p>
                      <p className="text-[10px] text-white/30">{(item.file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" style={{ color: "#00E676" }} /> AI
                      </span>
                      <button
                        onClick={() => removeFile(item.id)}
                        className="p-1 rounded-md text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/8 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white/50 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={queue.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
            style={{ background: "#00E676" }}
          >
            <Sparkles className="w-4 h-4" />
            {queue.length === 0
              ? "Select photos first"
              : `Analyze & Upload ${queue.length} Avatar${queue.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
