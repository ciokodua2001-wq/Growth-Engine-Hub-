import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Send, Save, Users, Megaphone, Globe, ChevronDown,
  Loader2, CheckCircle, AlertCircle, Filter, RefreshCw,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Target type picker ─────────────────────────────────────────────────── */

const TARGET_OPTIONS = [
  {
    value: "external",
    label: "External Contacts",
    description: "Send to imported contact list or a specific segment",
    icon: Users,
  },
  {
    value: "platform_users",
    label: "Platform Users",
    description: "Target GrowthForge users by lifecycle criteria",
    icon: Filter,
  },
  {
    value: "broadcast",
    label: "All Users Broadcast",
    description: "Send to every GrowthForge user (trial + paid)",
    icon: Megaphone,
  },
] as const;

/* ─── Platform user filter panel ─────────────────────────────────────────── */

type UserFilter = {
  subscriptionStatus: string;
  plan: string;
};

function UserFilterPanel({
  filter,
  onChange,
}: {
  filter: UserFilter;
  onChange: (f: UserFilter) => void;
}) {
  const q = new URLSearchParams();
  if (filter.subscriptionStatus !== "all") q.set("subscriptionStatus", filter.subscriptionStatus);
  if (filter.plan !== "all") q.set("plan", filter.plan);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["owner-user-segment", filter],
    queryFn: () => fetch(`${API}/api/owner/users/segment?${q}`).then(r => r.json()),
    enabled: true,
  });

  const total = data?.total ?? null;

  const sel = (name: keyof UserFilter, opts: { value: string; label: string }[]) => (
    <div className="relative">
      <select
        value={filter[name]}
        onChange={e => onChange({ ...filter, [name]: e.target.value })}
        className="w-full appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400/40 pr-8"
      >
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
    </div>
  );

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-3">
      <p className="text-white/40 text-xs uppercase tracking-wide font-medium">User filters</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-white/30 text-xs mb-1 block">Status</label>
          {sel("subscriptionStatus", [
            { value: "all", label: "All statuses" },
            { value: "trial", label: "Trial" },
            { value: "paid", label: "Paid / Active" },
            { value: "cancelled", label: "Cancelled" },
          ])}
        </div>
        <div>
          <label className="text-white/30 text-xs mb-1 block">Plan</label>
          {sel("plan", [
            { value: "all", label: "All plans" },
            { value: "starter", label: "Starter" },
            { value: "get-going", label: "Get-Going" },
            { value: "growth", label: "Growth" },
            { value: "scale", label: "Scale" },
          ])}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          {isFetching
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin text-white/30" /><span className="text-white/30 text-xs">Counting…</span></>
            : total != null
              ? <><CheckCircle className="w-3.5 h-3.5 text-amber-400" /><span className="text-white/70 text-sm"><span className="font-semibold text-white">{total}</span> eligible recipients</span></>
              : null
          }
        </div>
        <button onClick={() => refetch()} className="text-white/30 hover:text-white/60 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── External segment picker ─────────────────────────────────────────────── */

function ExternalSegmentPicker({
  selectedSegmentId,
  onChange,
}: {
  selectedSegmentId: number | null;
  onChange: (id: number | null) => void;
}) {
  const { data: segments, isLoading } = useQuery<Array<{ id: number; name: string; filterJson: { tags?: string[] } | null }>>({
    queryKey: ["owner-segments"],
    queryFn: () => fetch(`${API}/api/owner/segments`).then(r => r.json()),
  });

  if (isLoading) return <div className="text-white/30 text-xs">Loading segments…</div>;

  const list = Array.isArray(segments) ? segments : [];

  return (
    <div className="space-y-2">
      <p className="text-white/40 text-xs uppercase tracking-wide font-medium">Segment (optional)</p>
      <p className="text-white/30 text-xs">Leave blank to send to all non-unsubscribed contacts.</p>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          onClick={() => onChange(null)}
          className={`text-left p-3 rounded-xl border text-sm transition-colors ${
            selectedSegmentId === null
              ? "border-amber-400/40 bg-amber-400/5 text-amber-300"
              : "border-white/10 text-white/40 hover:border-white/20"
          }`}
        >
          <Globe className="w-4 h-4 mb-1" />
          All contacts
        </button>
        {list.map(seg => (
          <button
            key={seg.id}
            onClick={() => onChange(seg.id)}
            className={`text-left p-3 rounded-xl border text-sm transition-colors ${
              selectedSegmentId === seg.id
                ? "border-amber-400/40 bg-amber-400/5 text-amber-300"
                : "border-white/10 text-white/40 hover:border-white/20"
            }`}
          >
            <p className="font-medium text-inherit">{seg.name}</p>
            {seg.filterJson?.tags?.length ? (
              <p className="text-[10px] text-white/30 mt-0.5">{seg.filterJson.tags.join(", ")}</p>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Main composer ──────────────────────────────────────────────────────── */

export default function OwnerCampaignComposer() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<"external" | "platform_users" | "broadcast">("external");
  const [segmentId, setSegmentId] = useState<number | null>(null);
  const [userFilter, setUserFilter] = useState<UserFilter>({ subscriptionStatus: "all", plan: "all" });
  const [sentResult, setSentResult] = useState<{ sentCount: number; failCount: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch(`${API}/api/owner/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
  });

  const sendMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/api/owner/campaigns/${id}/send`, { method: "POST" }).then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["owner-campaigns"] });
      if (data.error) { setSendError(data.error); return; }
      setSentResult({ sentCount: data.sentCount, failCount: data.failCount ?? 0 });
    },
  });

  const isValid = name.trim() && subject.trim() && body.trim();

  const buildPayload = () => ({
    name: name.trim(),
    subject: subject.trim(),
    body: body.trim(),
    targetType,
    segmentId: targetType === "external" ? segmentId : null,
    filterJson: targetType === "platform_users"
      ? { subscriptionStatus: userFilter.subscriptionStatus, plan: userFilter.plan }
      : null,
  });

  const handleSaveDraft = async () => {
    const data = await createMut.mutateAsync(buildPayload());
    if (data.error) return;
    qc.invalidateQueries({ queryKey: ["owner-campaigns"] });
    setLocation("/admin/owner/campaigns");
  };

  const handleSendNow = async () => {
    setSendError(null);
    const data = await createMut.mutateAsync(buildPayload());
    if (data.error || !data.id) { setSendError(data.error ?? "Failed to create campaign"); return; }
    sendMut.mutate(data.id);
  };

  if (sentResult) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <CheckCircle className="w-12 h-12 mx-auto mb-4" style={{ color: "#fbbf24" }} />
        <h2 className="text-white text-2xl font-semibold mb-2">Campaign sent!</h2>
        <p className="text-white/50 mb-1">{sentResult.sentCount.toLocaleString()} emails delivered.</p>
        {sentResult.failCount > 0 && <p className="text-red-400 text-sm mb-4">{sentResult.failCount} sends failed.</p>}
        <button
          onClick={() => setLocation("/admin/owner/campaigns")}
          className="mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold text-black"
          style={{ background: "#fbbf24" }}
        >
          View Campaigns
        </button>
      </div>
    );
  }

  const busy = createMut.isPending || sendMut.isPending;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setLocation("/admin/owner/campaigns")}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-white">New Campaign</h1>
          <p className="text-white/40 text-sm">Compose and send an email campaign</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Name + subject */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-white/40 text-xs uppercase tracking-wide mb-1.5 block">Campaign name (internal)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. July re-engagement"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-amber-400/40"
            />
          </div>
          <div>
            <label className="text-white/40 text-xs uppercase tracking-wide mb-1.5 block">Email subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. We've got something for you, {{first_name}}"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-amber-400/40"
            />
            <p className="text-white/20 text-xs mt-1">Use <span className="font-mono">{"{{first_name}}"}</span> for personalisation.</p>
          </div>
          <div>
            <label className="text-white/40 text-xs uppercase tracking-wide mb-1.5 block">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write your email body here…"
              rows={10}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-white/30 focus:outline-none focus:border-amber-400/40 resize-none leading-relaxed"
            />
            <p className="text-white/20 text-xs mt-1">Plain text. An unsubscribe footer is automatically added to every email.</p>
          </div>
        </div>

        {/* Target type */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
          <p className="text-white/40 text-xs uppercase tracking-wide font-medium mb-3">Recipient target</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {TARGET_OPTIONS.map(opt => {
              const Icon = opt.icon;
              const active = targetType === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTargetType(opt.value)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    active
                      ? "border-amber-400/40 bg-amber-400/5"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <Icon className={`w-4 h-4 mb-2 ${active ? "text-amber-400" : "text-white/30"}`} />
                  <p className={`font-medium text-xs ${active ? "text-amber-300" : "text-white/60"}`}>{opt.label}</p>
                  <p className="text-white/30 text-[10px] mt-0.5 leading-tight">{opt.description}</p>
                </button>
              );
            })}
          </div>

          {targetType === "external" && (
            <ExternalSegmentPicker selectedSegmentId={segmentId} onChange={setSegmentId} />
          )}
          {targetType === "platform_users" && (
            <UserFilterPanel filter={userFilter} onChange={setUserFilter} />
          )}
          {targetType === "broadcast" && (
            <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl p-3">
              <p className="text-amber-300 text-sm">
                ⚡ This will send to <strong>all GrowthForge users</strong> (trial + paid) who haven't unsubscribed.
              </p>
            </div>
          )}
        </div>

        {/* Errors */}
        {sendError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {sendError}
          </div>
        )}

        {/* CTAs */}
        <div className="flex items-center gap-3 justify-end pb-8">
          <button
            disabled={!isValid || busy}
            onClick={handleSaveDraft}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-40"
          >
            {createMut.isPending && !sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </button>
          <button
            disabled={!isValid || busy}
            onClick={handleSendNow}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-black disabled:opacity-40"
            style={{ background: "#fbbf24" }}
          >
            {busy && sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Now
          </button>
        </div>
      </div>
    </div>
  );
}
