import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Check, Bell, ArrowRight } from "lucide-react";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  feature?: string;
  limit?: number;
  limitLabel?: string;
}

const UPGRADE_HIGHLIGHTS = [
  "Unlimited analyses & competitor reports",
  "Unlimited social posts & email campaigns",
  "Unlimited videos & ad creatives",
  "Unlimited Forge AI messages",
  "Multiple projects",
  "Advanced analytics & reporting",
];

export function UpgradeModal({ open, onClose, feature, limit, limitLabel }: UpgradeModalProps) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const handleClose = () => {
    setSubmitted(false);
    setEmail("");
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="w-full max-w-md rounded-2xl border border-white/10 p-8 pointer-events-auto relative"
              style={{ background: "#080f1e" }}
            >
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {!submitted ? (
                <>
                  {/* Icon */}
                  <div className="w-14 h-14 rounded-2xl bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mb-5">
                    <Zap className="w-7 h-7 text-[#00E676]" />
                  </div>

                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold mb-3">
                    <Bell className="w-3 h-3" /> Billing Coming Soon
                  </div>

                  <h2 className="text-2xl font-bold text-white mb-2">
                    {feature ? `You've reached your ${feature} limit` : "Trial limit reached"}
                  </h2>
                  <p className="text-white/50 text-sm mb-5">
                    {limit && limitLabel
                      ? `Your free trial includes ${limit} ${limitLabel}. Paid plans are launching soon — join the waitlist for early access and an exclusive discount.`
                      : "Your free trial has reached its limit. Paid plans are launching soon — be first in line."}
                  </p>

                  <ul className="flex flex-col gap-2 mb-6">
                    {UPGRADE_HIGHLIGHTS.map((item) => (
                      <li key={item} className="flex items-center gap-2.5 text-sm text-white/60">
                        <Check className="w-4 h-4 text-[#00E676] shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>

                  <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E676]/50 text-sm"
                    />
                    <button
                      type="submit"
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#00E676] text-black font-bold text-sm hover:bg-[#14F195] transition-all shadow-lg shadow-[#00E676]/20"
                    >
                      Join Early Access <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>

                  <button
                    onClick={handleClose}
                    className="w-full mt-3 py-2.5 text-sm text-white/30 hover:text-white/50 transition-colors"
                  >
                    Maybe later
                  </button>
                </>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-4"
                >
                  <div className="w-16 h-16 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-[#00E676]" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">You're on the list!</h3>
                  <p className="text-white/50 text-sm mb-6">
                    We'll notify <strong className="text-white">{email}</strong> the moment paid plans go live — with an exclusive early-access offer.
                  </p>
                  <button
                    onClick={handleClose}
                    className="px-6 py-2.5 rounded-full bg-white/8 text-white/70 text-sm hover:bg-white/15 transition-colors"
                  >
                    Got it
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
