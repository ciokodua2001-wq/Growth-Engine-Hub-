import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, GraduationCap, CreditCard, RefreshCw } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { apiFetch } from "@/lib/api";
import type { ZStudentProfile, ZQuota } from "@/lib/types";

const GRADES = [
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
];

export default function Settings() {
  const [, navigate] = useLocation();
  const { user } = useUser();
  const [profile, setProfile] = useState<ZStudentProfile | null>(null);
  const [quota, setQuota] = useState<ZQuota | null>(null);
  const [grade, setGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<ZStudentProfile>("/z/profile").catch(() => null),
      apiFetch<ZQuota>("/z/quota").catch(() => null),
    ]).then(([p, q]) => {
      setProfile(p);
      setQuota(q);
      if (p) setGrade(p.grade ?? "");
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await apiFetch<ZStudentProfile>("/z/profile", {
        method: "PUT",
        body: JSON.stringify({ grade: grade || null }),
      });
      setProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/z/subscription/checkout", { method: "POST" });
      if (url) window.location.href = url;
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManage = async () => {
    setPortalLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/z/subscription/portal", { method: "POST" });
      if (url) window.location.href = url;
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080B14] text-white">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate("/")}
          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-sm">
          Z
        </div>
        <span className="font-semibold">Settings</span>
      </header>

      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
        {/* Account */}
        <section className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
          <h2 className="text-sm font-semibold text-white mb-3">Account</h2>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-900/40 border border-indigo-700/30 flex items-center justify-center text-lg">
              {user?.firstName?.[0] ?? "?"}
            </div>
            <div>
              <div className="text-sm font-medium text-white">{user?.fullName ?? "Student"}</div>
              <div className="text-xs text-white/40">{user?.primaryEmailAddress?.emailAddress}</div>
            </div>
          </div>
        </section>

        {/* Grade */}
        <section className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <GraduationCap className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Grade</h2>
          </div>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Select grade…</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
          >
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {saved ? "Saved!" : saving ? "Saving…" : "Save"}
          </button>
        </section>

        {/* Subscription */}
        <section className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-white">Subscription</h2>
          </div>
          {quota?.plan === "paid" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-white">Active — Unlimited plan</span>
              </div>
              <div className="text-xs text-white/40">
                {quota.remaining} of {quota.limit} questions remaining this month
                {quota.resetAt && ` · Resets ${new Date(quota.resetAt).toLocaleDateString()}`}
              </div>
              <button
                onClick={handleManage}
                disabled={portalLoading}
                className="px-4 py-2 border border-white/10 hover:border-white/20 rounded-lg text-sm text-white/60 hover:text-white transition-colors"
              >
                {portalLoading ? "Opening…" : "Manage subscription"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-sm text-white">Free plan</span>
              </div>
              <p className="text-xs text-white/40">10 questions per session. Upgrade for a monthly allowance.</p>
              <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-br from-indigo-950/60 to-violet-950/60 border border-indigo-700/20">
                <div>
                  <div className="text-sm font-semibold text-white">Unlimited plan</div>
                  <div className="text-xs text-white/40">$9.99 / month · cancel anytime</div>
                </div>
                <button
                  onClick={handleUpgrade}
                  disabled={checkoutLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                >
                  {checkoutLoading ? "Loading…" : "Upgrade"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
