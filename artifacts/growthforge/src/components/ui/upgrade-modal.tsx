import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Check, ArrowRight, CreditCard } from "lucide-react";

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
  "Unlimited Promotional Videos",
  "Unlimited Forge AI messages",
  "Multiple projects",
  "Advanced analytics & reporting",
];

export function UpgradeModal({ open, onClose, feature, limit, limitLabel }: UpgradeModalProps) {
  const [, setLocation] = useLocation();

  const handleUpgrade = () => {
    onClose();
    setLocation("/plans");
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
            onClick={onClose}
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
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon */}
              <div className="w-14 h-14 rounded-2xl bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mb-5">
                <Zap className="w-7 h-7 text-[#00E676]" />
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">
                {feature ? `You've used all your ${feature}` : "Trial limit reached"}
              </h2>
              <p className="text-white/50 text-sm mb-5">
                {limit && limitLabel
                  ? `Your free trial includes ${limit} ${limitLabel}. Upgrade to a paid plan to unlock more.`
                  : "Your free trial has reached its limit. Upgrade to keep generating content."}
              </p>

              <ul className="flex flex-col gap-2 mb-6">
                {UPGRADE_HIGHLIGHTS.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-white/60">
                    <Check className="w-4 h-4 text-[#00E676] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>

              {/* Pricing teaser */}
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl mb-4"
                style={{ background: "#00E67610", border: "1px solid #00E67625" }}
              >
                <div>
                  <p className="text-xs text-white/40">Starting from</p>
                  <p className="text-lg font-bold text-white">$39<span className="text-sm font-normal text-white/40">/mo</span></p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#00E676]">Starter · Get-Going · Growth · Agency</p>
                  <p className="text-[10px] text-white/30 mt-0.5">Cancel anytime</p>
                </div>
              </div>

              <button
                onClick={handleUpgrade}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#00E676] text-black font-bold text-sm hover:bg-[#14F195] transition-all shadow-lg shadow-[#00E676]/20"
              >
                <CreditCard className="w-4 h-4" />
                View Plans & Upgrade <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={onClose}
                className="w-full mt-3 py-2.5 text-sm text-white/30 hover:text-white/50 transition-colors"
              >
                Maybe later
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
