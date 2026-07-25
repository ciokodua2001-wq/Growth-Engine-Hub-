import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Film, RefreshCw, CheckCircle } from "lucide-react";
import AdminLayout from "@/components/admin/admin-layout";

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-5 border-b border-white/6 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{label}</div>
        {desc && <div className="text-xs text-white/30 mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextInput({ defaultValue, placeholder }: { defaultValue?: string; placeholder?: string }) {
  return (
    <input defaultValue={defaultValue} placeholder={placeholder}
      className="w-56 px-3 py-2 rounded-xl border border-white/8 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
      style={{ background: "rgba(255,255,255,0.03)" }} />
  );
}

/* ─── Video credit config panel ────────────────────────────── */
const PLAN_KEYS = [
  { key: "trial_monthly_seconds",     label: "Trial"      },
  { key: "starter_monthly_seconds",   label: "Starter"    },
  { key: "get_going_monthly_seconds", label: "Get Going"  },
  { key: "growth_monthly_seconds",    label: "Growth"     },
  { key: "agency_monthly_seconds",    label: "Agency"     },
];

const PRICE_KEYS = [
  { key: "retail_price_per_second_usd", label: "Retail price / second (USD)", placeholder: "1.25" },
  { key: "kling_cost_per_credit_usd",   label: "Kling cost / credit (USD)",   placeholder: "0.145" },
  { key: "low_balance_warning_pct",     label: "Low-balance warning threshold (%)", placeholder: "25" },
];

function VideoConfigPanel() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery<{ config: Record<string, string> }>({
    queryKey: ["admin-video-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/video-config");
      if (!r.ok) throw new Error("Failed to load video config");
      return r.json() as Promise<{ config: Record<string, string> }>;
    },
  });

  useEffect(() => {
    if (data?.config) setDraft(data.config);
  }, [data]);

  const save = useMutation({
    mutationFn: async (updates: Record<string, string>) => {
      const r = await fetch("/api/admin/video-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-video-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const handleSave = () => save.mutate(draft);
  const set = (key: string, val: string) => setDraft(d => ({ ...d, [key]: val }));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-white/30 text-sm py-4">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading config…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Monthly seconds per plan */}
      <div>
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Monthly Seconds Per Plan</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {PLAN_KEYS.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs text-white/40 mb-1.5">{label}</label>
              <input
                type="number"
                min={0}
                value={draft[key] ?? ""}
                onChange={e => set(key, e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-white/8 text-sm text-white text-center focus:outline-none focus:border-white/20 transition-colors"
                style={{ background: "rgba(255,255,255,0.04)" }}
              />
              {Number(draft[key] ?? 0) > 0 && (
                <p className="text-[10px] text-white/25 text-center mt-1">
                  ~{Math.round(Number(draft[key]) / 15)} videos
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pricing & thresholds */}
      <div>
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Pricing & Thresholds</p>
        <div className="space-y-0 rounded-xl overflow-hidden border border-white/6"
          style={{ background: "rgba(255,255,255,0.02)" }}>
          {PRICE_KEYS.map(({ key, label, placeholder }) => (
            <div key={key} className="flex items-center justify-between px-4 py-3 border-b border-white/4 last:border-0 gap-4">
              <span className="text-sm text-white/60">{label}</span>
              <input
                type="text"
                value={draft[key] ?? ""}
                placeholder={placeholder}
                onChange={e => set(key, e.target.value)}
                className="w-28 px-3 py-1.5 rounded-lg border border-white/8 text-sm text-white text-right font-mono focus:outline-none focus:border-white/20 transition-colors"
                style={{ background: "rgba(255,255,255,0.04)" }}
              />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={save.isPending}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{ background: saved ? "#14F195" : "#00D4FF" }}>
        {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saved ? "Saved!" : save.isPending ? "Saving…" : "Save Video Config"}
      </button>
    </div>
  );
}

export default function AdminSettings() {
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <AdminLayout>
      <div className="p-6 md:p-8 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Platform Settings</h1>
            <p className="text-white/40 text-sm mt-0.5">Global configuration for GrowthForge</p>
          </div>
          <button onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02]"
            style={{ background: saved ? "#14F195" : "#00E676" }}>
            <Save className="w-4 h-4" />
            {saved ? "Saved!" : "Save Changes"}
          </button>
        </div>

        {[
          {
            title: "General",
            rows: [
              { label: "Platform Name", desc: "Displayed in emails and notifications", el: <TextInput defaultValue="GrowthForge" /> },
              { label: "Support Email", desc: "Users contact this address for help", el: <TextInput defaultValue="support@usegrowthforge.com" /> },
              { label: "Company Name", desc: "Legal entity name", el: <TextInput defaultValue="Strapli Technologies Inc." /> },
            ],
          },
          {
            title: "Trial & Subscriptions",
            rows: [
              { label: "Trial Length (days)", desc: "Free trial duration for new users", el: <TextInput defaultValue="7" /> },
              { label: "Starter Price ($/mo)", desc: "", el: <TextInput defaultValue="49" /> },
              { label: "Growth Price ($/mo)", desc: "", el: <TextInput defaultValue="99" /> },
              { label: "Agency Price ($/mo)", desc: "", el: <TextInput defaultValue="299" /> },
            ],
          },
          {
            title: "Branding",
            rows: [
              { label: "Primary Color", desc: "Used for CTAs and highlights", el: <TextInput defaultValue="#00E676" /> },
              { label: "Secondary Color", desc: "Used for accents", el: <TextInput defaultValue="#00D4FF" /> },
              { label: "Homepage URL", desc: "", el: <TextInput defaultValue="https://usegrowthforge.com" /> },
            ],
          },
        ].map(({ title, rows }) => (
          <div key={title} className="rounded-2xl border border-white/8 overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="px-6 py-4 border-b border-white/6">
              <h2 className="text-sm font-bold text-white">{title}</h2>
            </div>
            <div className="px-6">
              {rows.map(({ label, desc, el }) => (
                <SettingRow key={label} label={label} desc={desc}>{el}</SettingRow>
              ))}
            </div>
          </div>
        ))}

        {/* Video Credit Configuration */}
        <div className="rounded-2xl border border-[#00D4FF]/15 overflow-hidden"
          style={{ background: "rgba(0,212,255,0.02)" }}>
          <div className="px-6 py-4 border-b border-white/6 flex items-center gap-3">
            <Film className="w-4 h-4 text-[#00D4FF]" />
            <h2 className="text-sm font-bold text-white">Video Credit Configuration</h2>
          </div>
          <div className="px-6 py-5">
            <VideoConfigPanel />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
