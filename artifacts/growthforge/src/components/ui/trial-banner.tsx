import { useState } from "react";
import { Link } from "wouter";
import { Zap, X, Bell } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface TrialBannerProps {
  trialEndsAt?: string | Date | null;
  subscriptionStatus?: string;
}

export function TrialBanner({ trialEndsAt, subscriptionStatus }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (subscriptionStatus !== "trial" || dismissed || !trialEndsAt) return null;

  const daysLeft = Math.max(0, Math.ceil(
    (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ));

  if (daysLeft === 0) return null;

  const isUrgent = daysLeft <= 3;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={`flex items-center justify-between gap-4 px-5 py-2.5 text-sm border-b ${
          isUrgent
            ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
            : "bg-[#00E676]/8 border-[#00E676]/15 text-[#00E676]"
        }`}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>{daysLeft} day{daysLeft !== 1 ? "s" : ""}</strong> left in your free trial.{" "}
            {isUrgent ? "Paid plans launching soon — join the waitlist." : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/plans"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00E676] text-black text-xs font-bold hover:bg-[#14F195] transition-colors"
          >
            <Bell className="w-3 h-3" /> Early Access
          </Link>
          <button
            onClick={() => setDismissed(true)}
            className="text-current opacity-50 hover:opacity-100 transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
