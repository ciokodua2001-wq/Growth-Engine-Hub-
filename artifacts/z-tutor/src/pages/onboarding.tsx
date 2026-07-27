import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, GraduationCap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";

const GRADES = [
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const [grade, setGrade] = useState("");
  const [saving, setSaving] = useState(false);

  const handleStart = async () => {
    if (!grade) return;
    setSaving(true);
    try {
      await apiFetch("/z/profile", {
        method: "PUT",
        body: JSON.stringify({ grade }),
      });
      navigate("/");
    } catch (err) {
      console.error("Failed to save profile", err);
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080B14] text-white flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-900/40">
          Z
        </div>
        <span className="text-white/60 text-sm tracking-widest uppercase">Quantivarian</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <div className="w-9 h-9 rounded-lg bg-indigo-900/60 border border-indigo-700/30 flex items-center justify-center mb-4">
          <GraduationCap className="w-4 h-4 text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-1">What grade are you in?</h2>
        <p className="text-white/40 text-sm mb-6">
          Z will match its explanations and examples to your level.
        </p>

        <div className="grid grid-cols-3 gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`px-4 py-3 rounded-lg text-sm text-left transition-all font-medium border ${
                grade === g
                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-200"
                  : "bg-white/[0.03] border-white/5 text-white/60 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </motion.div>

      <button
        onClick={handleStart}
        disabled={!grade || saving}
        className="mt-8 flex items-center gap-2 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        {saving ? "Saving..." : "Start learning"}
        {!saving && <ChevronRight className="w-4 h-4" />}
      </button>
    </div>
  );
}
