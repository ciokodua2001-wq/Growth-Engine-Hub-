import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/admin-layout";
import {
  Users, Upload, Search, Tag, Plus, Trash2, X, ChevronDown,
  Filter, Download, CheckCircle, AlertCircle, Loader2,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Contact {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  tags: string[];
  unsubscribed: boolean;
  source: string;
  createdAt: string;
}

interface ContactsResponse {
  contacts: Contact[];
  total: number;
  allTags: string[];
}

function useContacts(params: { search?: string; tag?: string; offset?: number }) {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.tag) q.set("tag", params.tag);
  if (params.offset) q.set("offset", String(params.offset));
  return useQuery<ContactsResponse>({
    queryKey: ["owner-contacts", params],
    queryFn: () => fetch(`${API}/api/owner/contacts?${q}`).then(r => r.json()),
  });
}

function ImportModal({ onClose, allTags }: { onClose: () => void; allTags: string[] }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const [newTag, setNewTag] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useMutation({
    mutationFn: (body: { csv: string; tags: string[] }) =>
      fetch(`${API}/api/owner/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner-contacts"] }); },
  });

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setCsv(e.target?.result as string);
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const addTag = () => {
    const t = newTag.trim().toLowerCase();
    if (t && !selectedTags.includes(t)) setSelectedTags(p => [...p, t]);
    setNewTag("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Import Contacts</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-white/50 text-sm mb-4">
          Upload a CSV or TXT file with columns: <span className="text-white/70 font-mono text-xs">email, first_name, last_name, company</span>. The header row is auto-detected.
        </p>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${dragging ? "border-amber-400/60 bg-amber-400/5" : "border-white/10 hover:border-white/20"}`}
        >
          <Upload className="w-8 h-8 mx-auto mb-2 text-white/30" />
          <p className="text-white/50 text-sm">{csv ? `File loaded (${csv.split("\n").length} lines)` : "Drop CSV file here or click to browse"}</p>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        </div>

        {/* Tags */}
        <div className="mb-4">
          <label className="text-white/50 text-xs font-medium uppercase tracking-wide mb-2 block">Apply tags to imported contacts</label>
          <div className="flex gap-2 flex-wrap mb-2">
            {selectedTags.map(t => (
              <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-300 text-xs">
                {t}
                <button onClick={() => setSelectedTags(p => p.filter(x => x !== t))}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="Add a tag…"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/40"
            />
            <button onClick={addTag} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors">Add</button>
          </div>
          {allTags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {allTags.filter(t => !selectedTags.includes(t)).map(t => (
                <button key={t} onClick={() => setSelectedTags(p => [...p, t])} className="text-xs px-2 py-0.5 rounded-full border border-white/10 text-white/40 hover:border-amber-400/40 hover:text-amber-300 transition-colors">{t}</button>
              ))}
            </div>
          )}
        </div>

        {importMut.data && (
          <div className={`flex items-start gap-2 p-3 rounded-xl mb-4 text-sm ${importMut.data.error ? "bg-red-500/10 text-red-300" : "bg-green-500/10 text-green-300"}`}>
            {importMut.data.error
              ? <><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{importMut.data.error}</>
              : <><CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  Imported {importMut.data.imported} contacts.
                  {importMut.data.skipped > 0 && ` ${importMut.data.skipped} duplicates skipped.`}
                  {importMut.data.suppressedCount > 0 && ` ${importMut.data.suppressedCount} suppressed.`}
                  {importMut.data.invalid > 0 && ` ${importMut.data.invalid} invalid emails.`}
                </>
            }
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors">Cancel</button>
          <button
            disabled={!csv || importMut.isPending}
            onClick={() => importMut.mutate({ csv, tags: selectedTags })}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all disabled:opacity-40"
            style={{ background: "#fbbf24" }}
          >
            {importMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSegmentModal({ allTags, onClose }: { allTags: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const createMut = useMutation({
    mutationFn: (body: { name: string; filterJson: Record<string, unknown>; segmentType: string }) =>
      fetch(`${API}/api/owner/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner-segments"] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">New Segment</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-white/50 text-xs uppercase tracking-wide mb-1 block">Segment name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. SaaS founders, UK contacts"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-amber-400/40"
            />
          </div>
          <div>
            <label className="text-white/50 text-xs uppercase tracking-wide mb-2 block">Filter by tags (contacts must have any selected tag)</label>
            <div className="flex gap-1.5 flex-wrap">
              {allTags.map(t => (
                <button
                  key={t}
                  onClick={() => setSelectedTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    selectedTags.includes(t)
                      ? "border-amber-400 bg-amber-400/10 text-amber-300"
                      : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                  }`}
                >
                  {t}
                </button>
              ))}
              {allTags.length === 0 && <p className="text-white/30 text-xs">No tags yet — import contacts with tags first.</p>}
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors">Cancel</button>
          <button
            disabled={!name.trim() || createMut.isPending}
            onClick={() => createMut.mutate({ name: name.trim(), filterJson: { tags: selectedTags }, segmentType: "external" })}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-black disabled:opacity-40"
            style={{ background: "#fbbf24" }}
          >
            {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OwnerContacts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState<string | undefined>();
  const [showImport, setShowImport] = useState(false);
  const [showNewSegment, setShowNewSegment] = useState(false);

  const { data, isLoading } = useContacts({ search: search || undefined, tag: filterTag });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetch(`${API}/api/owner/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-contacts"] }),
  });

  const contacts = data?.contacts ?? [];
  const allTags = data?.allTags ?? [];

  return (
    <AdminLayout>
    <div className="max-w-6xl mx-auto">
      {showImport && <ImportModal onClose={() => setShowImport(false)} allTags={allTags} />}
      {showNewSegment && <NewSegmentModal allTags={allTags} onClose={() => setShowNewSegment(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(251,191,36,0.15)" }}>
              <Users className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
            </div>
            <h1 className="text-xl font-semibold text-white">Contacts</h1>
          </div>
          <p className="text-white/40 text-sm">{data?.total ?? 0} contacts · external mailing list</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewSegment(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
          >
            <Tag className="w-3.5 h-3.5" />
            New Segment
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-black transition-all"
            style={{ background: "#fbbf24" }}
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/40"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/30 text-xs">Tag:</span>
            <button
              onClick={() => setFilterTag(undefined)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${!filterTag ? "border-amber-400 text-amber-300 bg-amber-400/10" : "border-white/10 text-white/40 hover:border-white/20"}`}
            >
              All
            </button>
            {allTags.map(t => (
              <button
                key={t}
                onClick={() => setFilterTag(filterTag === t ? undefined : t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${filterTag === t ? "border-amber-400 text-amber-300 bg-amber-400/10" : "border-white/10 text-white/40 hover:border-white/20"}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-white/30" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-8 h-8 text-white/10 mb-3" />
            <p className="text-white/30 text-sm">No contacts yet — import a CSV to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/30 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Email</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Name</th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Company</th>
                <th className="text-left px-5 py-3 font-medium">Tags</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 text-white font-mono text-xs">{c.email}</td>
                  <td className="px-5 py-3 text-white/60 hidden md:table-cell">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || <span className="text-white/20">—</span>}
                  </td>
                  <td className="px-5 py-3 text-white/60 hidden lg:table-cell">{c.company || <span className="text-white/20">—</span>}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.tags.map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded-md text-[10px] bg-amber-400/10 text-amber-300">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${c.unsubscribed ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
                      {c.unsubscribed ? "Unsubscribed" : "Active"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => { if (confirm(`Delete ${c.email}?`)) deleteMut.mutate(c.id); }}
                      className="text-white/20 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
    </AdminLayout>
  );
}
