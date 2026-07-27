import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Plus, Clock, BookOpen, Sparkles, Settings, LogOut, ChevronRight } from "lucide-react";
import { useUser, useClerk } from "@clerk/clerk-react";
import { apiFetch } from "@/lib/api";
import type { ZStudentProfile, ZSession, ZQuota } from "@/lib/types";

const SUBJECTS = [
  "Mathematics", "Science", "English Language Arts", "French",
  "Social Studies", "History", "Geography", "Physics",
  "Chemistry", "Biology", "Computer Science", "Economics",
];

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [profile, setProfile] = useState<ZStudentProfile | null>(null);
  const [sessions, setSessions] = useState<ZSession[]>([]);
  const [quota, setQuota] = useState<ZQuota | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newLesson, setNewLesson] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<ZStudentProfile>("/z/profile").catch(() => null),
      apiFetch<ZSession[]>("/z/sessions").catch(() => []),
      apiFetch<ZQuota>("/z/quota").catch(() => null),
    ]).then(([p, s, q]) => {
      setProfile(p);
      setSessions(s ?? []);
      setQuota(q);
      setLoading(false);
      // If profile doesn't exist or missing grade, go to onboarding
      if (!p || !p.grade) {
        navigate("/onboarding");
      }
    });
  }, []);

  const handleCreateSession = async () => {
    if (!newSubject || !newLesson || !newUnit) return;
    setCreating(true);
    try {
      const session = await apiFetch<ZSession>("/z/sessions", {
        method: "POST",
        body: JSON.stringify({ subject: newSubject, lesson: newLesson, unit: newUnit }),
      });
      navigate(`/chat/${session.id}`);
    } catch (err) {
      console.error(err);
      setCreating(false);
    }
  };

  const quotaPercent = quota ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  const quotaColor = quotaPercent > 80 ? "from-red-500 to-rose-600" : quotaPercent > 50 ? "from-amber-500 to-orange-600" : "from-indigo-500 to-violet-600";

  return (
    <div className="min-h-screen bg-[#080B14] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 flex flex-col p-4 gap-1">
        {/* Logo */}
        <div className="flex items-center gap-3 p-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-900/40">
            Z
          </div>
          <div>
            <div className="font-semibold text-sm text-white">Quantivarian</div>
            <div className="text-xs text-indigo-400">AI Tutor</div>
          </div>
        </div>

        {/* New session */}
        <button
          onClick={() => setShowNewSession(true)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>

        {/* Recent sessions */}
        <div className="mt-4 mb-2 px-3 text-xs text-white/30 uppercase tracking-wider">Recent</div>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {sessions.slice(0, 20).map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/chat/${s.id}`)}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors group"
            >
              <div className="text-sm text-white/70 group-hover:text-white transition-colors truncate">{s.subject}</div>
              <div className="text-xs text-white/30 truncate">{s.lesson} · {s.unit}</div>
            </button>
          ))}
          {sessions.length === 0 && !loading && (
            <div className="px-3 py-4 text-xs text-white/20 italic">No sessions yet</div>
          )}
        </div>

        {/* Bottom */}
        <div className="border-t border-white/5 pt-3 space-y-0.5 mt-2">
          <button
            onClick={() => navigate("/settings")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-white/50 hover:text-white/70 transition-colors text-sm"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-white/50 hover:text-white/70 transition-colors text-sm"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
          <div className="px-3 py-2">
            <div className="text-xs text-white/30 truncate">{user?.primaryEmailAddress?.emailAddress}</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col p-8 overflow-y-auto">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">
                Good {getGreeting()}, {user?.firstName ?? "student"}.
              </h1>
              <p className="text-white/40 mt-1">
                {profile?.grade} · {[profile?.province, profile?.country].filter(Boolean).join(", ") || "Curriculum not set"}
              </p>
            </div>

            {/* Quota card */}
            {quota && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 p-5 rounded-xl bg-white/[0.03] border border-white/5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {quota.plan === "free" ? "Session quota" : "Monthly quota"}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {quota.remaining} question{quota.remaining !== 1 ? "s" : ""} remaining
                      {quota.plan === "free" && " · resets each new session"}
                      {quota.plan === "paid" && quota.resetAt && ` · resets ${new Date(quota.resetAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  {quota.plan === "free" && (
                    <button
                      onClick={() => navigate("/pricing")}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      Upgrade <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${quotaColor} rounded-full transition-all`}
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-white/20 mt-1.5">
                  <span>{quota.used} used</span>
                  <span>{quota.limit} total</span>
                </div>
              </motion.div>
            )}

            {/* Start a new session */}
            <div className="mb-6">
              <h2 className="text-sm text-white/40 uppercase tracking-wider mb-3">Start a new session</h2>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {SUBJECTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setNewSubject(s); setShowNewSession(true); }}
                    className="px-3 py-3 rounded-lg bg-white/[0.03] border border-white/5 text-sm text-white/60 hover:bg-indigo-900/20 hover:border-indigo-700/30 hover:text-indigo-300 transition-all text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent sessions */}
            {sessions.length > 0 && (
              <div>
                <h2 className="text-sm text-white/40 uppercase tracking-wider mb-3">Recent sessions</h2>
                <div className="space-y-2">
                  {sessions.slice(0, 5).map((s, i) => (
                    <motion.button
                      key={s.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => navigate(`/chat/${s.id}`)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-all text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-indigo-900/40 border border-indigo-700/20 flex items-center justify-center flex-shrink-0">
                        <BookOpen className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white">{s.subject}</div>
                        <div className="text-xs text-white/40">{s.lesson} · {s.unit}</div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/30">
                        <span>{s.messageCount} messages</span>
                        <ChevronRight className="w-4 h-4 group-hover:text-indigo-400 transition-colors" />
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* New session modal */}
      {showNewSession && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#0F1220] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
          >
            <h2 className="text-lg font-bold text-white mb-1">New tutoring session</h2>
            <p className="text-sm text-white/40 mb-5">Tell Z what you're studying today.</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Subject</label>
                <select
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select subject…</option>
                  {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Unit / Chapter</label>
                <input
                  type="text"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="e.g. Fractions and Decimals"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Lesson / Topic</label>
                <input
                  type="text"
                  value={newLesson}
                  onChange={(e) => setNewLesson(e.target.value)}
                  placeholder="e.g. Adding fractions with unlike denominators"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowNewSession(false); setNewSubject(""); setNewLesson(""); setNewUnit(""); }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-sm text-white/50 hover:text-white hover:border-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSession}
                disabled={!newSubject || !newLesson || !newUnit || creating}
                className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {creating ? "Starting…" : "Start session"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
