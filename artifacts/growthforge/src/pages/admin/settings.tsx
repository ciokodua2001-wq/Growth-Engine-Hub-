import { useState } from "react";
import { Save } from "lucide-react";
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
              { label: "Trial Length (days)", desc: "Free trial duration for new users", el: <TextInput defaultValue="14" /> },
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
      </div>
    </AdminLayout>
  );
}
