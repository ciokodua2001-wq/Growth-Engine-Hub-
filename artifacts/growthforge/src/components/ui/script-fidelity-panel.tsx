import { useState } from "react";
import { Check, FileText, Mic, AlertTriangle, Loader2, Pencil, X } from "lucide-react";
import type { Video as VideoModel } from "@workspace/api-client-react";

interface TranscriptSeg {
  text: string;
  startSec?: number;
  endSec?: number;
  timingSource?: "estimated" | "manual";
  reviewed?: boolean;
}

interface FidelityReport {
  status?: "unverified" | "matches" | "difference";
  similarity?: number;
  differences?: Array<{ type: string; approved?: string; spoken?: string; note?: string }>;
}

interface Props {
  video: VideoModel;
  projectId: number;
}

/**
 * Customer workflow for script approval + actual-audio transcription + dialogue
 * fidelity review + transcript correction + caption timing. Captions (preview
 * and export) are sourced ONLY from the reviewed transcript here.
 */
export default function ScriptFidelityPanel({ video, projectId }: Props) {
  const base = `/api/projects/${projectId}/videos/${video.id}`;

  const [approvedScript, setApprovedScript] = useState<string | null | undefined>(video.approvedScript);
  const [approvedVersion, setApprovedVersion] = useState<number>(video.approvedScriptVersion ?? 0);
  const [scriptStatus, setScriptStatus] = useState<string>(video.scriptStatus ?? "proposed");
  const [transcriptStatus, setTranscriptStatus] = useState<string>(video.transcriptStatus ?? "pending");
  const [fidelityStatus, setFidelityStatus] = useState<string>(video.fidelityStatus ?? "unverified");
  const [report, setReport] = useState<FidelityReport | null>(video.fidelityReport as FidelityReport | null);
  const [segments, setSegments] = useState<TranscriptSeg[]>(
    (video.dialogueTranscript as TranscriptSeg[] | null) ?? [],
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = async (url: string, opts?: RequestInit) => {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as any)?.message || (j as any)?.error || `HTTP ${r.status}`);
    return j;
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const approve = () => run("approving", async () => {
    const j = await api(`${base}/script/approve`, { method: "POST", body: JSON.stringify({ script: video.script }) });
    setApprovedScript(j.approvedScript); setApprovedVersion(j.approvedScriptVersion); setScriptStatus("approved");
  });

  const transcribe = () => run("transcribing", async () => {
    const j = await api(`${base}/transcript`, { method: "POST", body: JSON.stringify({}) });
    setSegments(j.transcript ?? []); setReport(j.fidelity); setFidelityStatus(j.fidelity?.status ?? "difference");
    setTranscriptStatus("needs_review"); setEditing(true);
  });

  const saveCorrection = () => run("saving", async () => {
    const j = await api(`${base}/transcript`, { method: "PUT", body: JSON.stringify({ segments }) });
    setSegments(j.transcript ?? segments); setReport(j.fidelity); setFidelityStatus(j.fidelity?.status ?? "difference");
    setTranscriptStatus("ready"); setEditing(false);
  });

  const accept = () => run("accepting", async () => {
    await api(`${base}/transcript/accept`, { method: "POST", body: JSON.stringify({}) });
    setTranscriptStatus("accepted");
  });

  const updateSeg = (i: number, patch: Partial<TranscriptSeg>) =>
    setSegments(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const badge = (label: string, tone: string) =>
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone}`}>{label}</span>;

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {/* ── Script approval + versioning ── */}
      <div className="rounded-xl bg-white/3 border border-white/8 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Script</span>
            {scriptStatus === "approved" ? badge(`Approved v${approvedVersion}`, "bg-emerald-500/15 text-emerald-400 border-emerald-500/30")
              : badge("Draft - not approved", "bg-amber-500/15 text-amber-400 border-amber-500/30")}
          </div>
          <button onClick={approve} disabled={busy !== null || !video.script}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
            {busy === "approving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {scriptStatus === "approved" ? "Re-approve (lock new version)" : "Approve Script"}
          </button>
        </div>
        {approvedScript && <pre className="text-[11px] text-emerald-200/80 whitespace-pre-wrap leading-relaxed font-sans">{approvedScript}</pre>}
      </div>

      {/* ── Transcribe + fidelity review ── */}
      <div className="rounded-xl bg-white/3 border border-white/8 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Dialogue fidelity</span>
            {fidelityStatus === "difference" ? badge("DIFFERENCE DETECTED", "bg-red-500/15 text-red-400 border-red-500/30")
              : fidelityStatus === "matches" ? badge("Matches", "bg-emerald-500/15 text-emerald-400 border-emerald-500/30")
              : badge("Unverified", "bg-white/10 text-white/50 border-white/20")}
          </div>
          <button onClick={transcribe} disabled={busy !== null}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
            {busy === "transcribing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
            Transcribe &amp; Check Fidelity
          </button>
        </div>

        {report && (
          <div className="text-[11px] space-y-1">
            <p className="text-muted-foreground">
              Similarity <span className="font-bold text-foreground">{Math.round((report.similarity ?? 0) * 100)}%</span>
              {" · "}transcript vs approved script
            </p>
            {(report.differences?.length ?? 0) > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-lg bg-black/20 p-2 space-y-0.5">
                {report.differences!.slice(0, 12).map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-white/70">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="font-mono">{d.type}</span>
                    {d.approved && <span className="line-through text-white/40">approved: {d.approved}</span>}
                    {d.spoken && <span className="text-emerald-300/80">spoken: {d.spoken}</span>}
                    {d.note && <span className="text-white/40">({d.note})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Transcript correction (text + manual timing) ── */}
        {segments.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Transcript (actual audio) - captions use ONLY this
              </span>
              <button onClick={() => setEditing(e => !e)}
                className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80">
                {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                {editing ? "Cancel" : "Correct transcript / timing"}
              </button>
            </div>
            {segments.map((s, i) => (
              <div key={i} className="rounded-lg bg-black/20 border border-white/6 p-2">
                {editing ? (
                  <div className="space-y-1.5">
                    <textarea value={s.text} onChange={e => updateSeg(i, { text: e.target.value })}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-white/25" rows={2} />
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <label>start <input type="number" step="0.1" value={s.startSec ?? ""} onChange={e => updateSeg(i, { startSec: parseFloat(e.target.value) || undefined, timingSource: "manual" })}
                        className="w-16 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-white" /></label>
                      <label>end <input type="number" step="0.1" value={s.endSec ?? ""} onChange={e => updateSeg(i, { endSec: parseFloat(e.target.value) || undefined, timingSource: "manual" })}
                        className="w-16 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-white" /></label>
                      <span className="text-white/30">{s.timingSource ?? "estimated"} timing</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-white/80 leading-snug">
                    <span className="text-white/35 font-mono">[{s.startSec?.toFixed(1)}-{s.endSec?.toFixed(1)}s]</span> {s.text}
                  </div>
                )}
              </div>
            ))}
            {editing && (
              <button onClick={saveCorrection} disabled={busy !== null}
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-black text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
                {busy === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save reviewed transcript
              </button>
            )}
            {(transcriptStatus === "needs_review" || fidelityStatus === "difference") && (
              <div className="flex items-center gap-2">
                <button onClick={accept} disabled={busy !== null}
                  className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300">
                  Accept performance as-is (keep approved script unchanged)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
