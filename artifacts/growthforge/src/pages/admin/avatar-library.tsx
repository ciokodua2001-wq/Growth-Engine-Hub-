import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Image as ImageIcon, Upload, Trash2, Pencil, X, Check,
  Loader2, AlertCircle, Users, Eye, EyeOff, GripVertical,
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

export default function AdminAvatarLibrary() {
  const queryClient = useQueryClient();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [filterGender, setFilterGender] = useState<string>("all");
  const [filterArchetype, setFilterArchetype] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

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
              Platform-wide presenter avatars that users can select for video rendering.
              <span className="ml-2 text-white/60">{activeCount} active · {avatars.length} total</span>
            </p>
          </div>
          <button
            onClick={() => { setShowUploadModal(true); setError(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-black shrink-0"
            style={{ background: "#00E676" }}
          >
            <Upload className="w-4 h-4" /> Upload Avatar
          </button>
        </div>

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
                ? 'No avatars uploaded yet. Click "Upload Avatar" to get started.'
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
        <UploadModal
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

function AvatarCard({
  avatar,
  isEditing,
  isDeleting,
  onEdit,
  onCancelEdit,
  onSaved,
  onToggleActive,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
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
          <p className="text-xs text-red-300 font-semibold text-center">Delete "{avatar.name}"?</p>
          <p className="text-[10px] text-white/40 text-center">This can't be undone.</p>
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
        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={onEdit}
            className="p-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggleActive}
            className="p-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
            title={avatar.isActive ? "Deactivate" : "Activate"}
          >
            {avatar.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDeleteRequest}
            className="p-2 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-red-300 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* HeyGen cached badge */}
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

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<string>("female");
  const [archetype, setArchetype] = useState<string>("presenter");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Photo must be JPEG, PNG, or WebP");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError("Photo must be under 15 MB");
      return;
    }
    setError(null);
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
    if (!name) {
      setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [name]);

  const handleUpload = async () => {
    if (!file || !name.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("name", name.trim());
      formData.append("gender", gender);
      formData.append("archetype", archetype);
      const res = await fetch("/api/admin/platform-avatars", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div className="w-full max-w-lg bg-[#0A1628] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <h2 className="font-bold text-white">Upload Platform Avatar</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-all min-h-[160px] ${
              dragging ? "border-[#00E676] bg-[#00E676]/5" : "border-white/15 hover:border-white/30 bg-white/3"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {preview ? (
              <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-white/20">
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-white/8">
                  <Upload className="w-5 h-5 text-white/50" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-white/70">Drag & drop or click to upload</p>
                  <p className="text-xs text-white/30 mt-0.5">JPEG · PNG · WebP · max 15 MB</p>
                </div>
              </>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1.5">Display name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah — Professional"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#00E676]/50 transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5">Gender</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00E676]/50"
                >
                  {GENDERS.map((g) => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-white/50 mb-1.5">Archetype</label>
                <select
                  value={archetype}
                  onChange={(e) => setArchetype(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00E676]/50"
                >
                  {ARCHETYPES.map((a) => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/8 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white/50 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || !name.trim() || uploading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
            style={{ background: "#00E676" }}
          >
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><Upload className="w-4 h-4" /> Upload Avatar</>}
          </button>
        </div>
      </div>
    </div>
  );
}
