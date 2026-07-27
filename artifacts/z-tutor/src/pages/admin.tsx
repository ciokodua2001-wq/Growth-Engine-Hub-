import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Users, CreditCard, LogOut, GraduationCap, ChevronDown, ChevronUp, Save } from "lucide-react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { apiFetch } from "@/lib/api";
import type { ZStudentProfile } from "@/lib/types";

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [students, setStudents] = useState<ZStudentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { plan: string; monthlyLimit: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ZStudentProfile[]>("/z/admin/users")
      .then((data) => { setStudents(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const getEdit = (userId: string, profile: ZStudentProfile) =>
    edits[userId] ?? {
      plan: profile.plan,
      monthlyLimit: String(profile.monthlyLimit ?? 200),
    };

  const handleSave = async (userId: string) => {
    const edit = edits[userId];
    if (!edit) return;
    setSaving(userId);
    try {
      const updated = await apiFetch<ZStudentProfile>(`/z/admin/users/${userId}/quota`, {
        method: "PATCH",
        body: JSON.stringify({
          plan: edit.plan,
          monthlyLimit: parseInt(edit.monthlyLimit, 10) || 200,
        }),
      });
      setStudents((prev) => prev.map((s) => s.userId === userId ? updated : s));
      setEdits((prev) => { const n = { ...prev }; delete n[userId]; return n; });
      setSaved(userId);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(null);
    }
  };

  const stats = {
    total: students.length,
    paid: students.filter((s) => s.plan === "paid").length,
    free: students.filter((s) => s.plan === "free").length,
  };

  return (
    <div className="min-h-screen bg-[#080B14] text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-900/40">
            Z
          </div>
          <div>
            <div className="font-semibold text-sm text-white">Quantivarian Admin</div>
            <div className="text-xs text-indigo-400">{user?.primaryEmailAddress?.emailAddress}</div>
          </div>
        </div>
        <button
          onClick={() => signOut({ redirectUrl: "/" })}
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors text-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total students", value: stats.total, icon: Users, color: "indigo" },
            { label: "Paid", value: stats.paid, icon: CreditCard, color: "violet" },
            { label: "Free", value: stats.free, icon: GraduationCap, color: "slate" },
          ].map((s) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-xl bg-white/[0.03] border border-white/5"
            >
              <div className="text-2xl font-bold text-white">{loading ? "—" : s.value}</div>
              <div className="text-sm text-white/40 mt-1">{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Students table */}
        <div>
          <h2 className="text-sm text-white/40 uppercase tracking-wider mb-3">Students</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-7 h-7 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-12 text-white/20 text-sm">No students yet</div>
          ) : (
            <div className="space-y-2">
              {students.map((s) => {
                const edit = getEdit(s.userId, s);
                const isExpanded = expanded === s.userId;
                const isDirty = !!edits[s.userId];

                return (
                  <div
                    key={s.userId}
                    className="rounded-xl bg-white/[0.03] border border-white/5 overflow-hidden"
                  >
                    {/* Row header */}
                    <button
                      onClick={() => setExpanded(isExpanded ? null : s.userId)}
                      className="w-full flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-indigo-900/40 border border-indigo-700/20 flex items-center justify-center text-xs font-semibold text-indigo-300 flex-shrink-0">
                        {s.userId.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{s.userId}</div>
                        <div className="text-xs text-white/30">
                          Grade: {s.grade ?? "not set"} · Joined {new Date(s.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full border ${
                          s.plan === "paid"
                            ? "bg-violet-900/30 border-violet-700/40 text-violet-300"
                            : "bg-white/5 border-white/10 text-white/40"
                        }`}>
                          {s.plan}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-white/30" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-white/30" />
                        )}
                      </div>
                    </button>

                    {/* Expanded controls */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-white/5 pt-4">
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Plan</label>
                            <select
                              value={edit.plan}
                              onChange={(e) => setEdits((prev) => ({
                                ...prev,
                                [s.userId]: { ...edit, plan: e.target.value },
                              }))}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                            >
                              <option value="free">Free</option>
                              <option value="paid">Paid</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Monthly limit</label>
                            <input
                              type="number"
                              min={1}
                              value={edit.monthlyLimit}
                              onChange={(e) => setEdits((prev) => ({
                                ...prev,
                                [s.userId]: { ...edit, monthlyLimit: e.target.value },
                              }))}
                              disabled={edit.plan === "free"}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-30"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-xs text-white/30 flex-1">
                            Used this month: {s.questionsUsedThisMonth} · Session: {s.questionsUsedThisSession}
                          </div>
                          {isDirty && (
                            <button
                              onClick={() => handleSave(s.userId)}
                              disabled={saving === s.userId}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
                            >
                              <Save className="w-3.5 h-3.5" />
                              {saving === s.userId ? "Saving…" : saved === s.userId ? "Saved!" : "Save"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
