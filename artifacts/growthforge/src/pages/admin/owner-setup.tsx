import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Crown, KeyRound, Mail, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export default function OwnerSetupPage() {
  const [, setLocation] = useLocation();

  const [email, setEmail] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "ready" | "submitting" | "done" | "already-done">("checking");
  const [error, setError] = useState<string | null>(null);

  // Check whether bootstrap is already done
  useEffect(() => {
    fetch("/api/owner/bootstrap", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { ownerExists: boolean }) => {
        if (data.ownerExists) {
          setStatus("already-done");
        } else {
          setStatus("ready");
        }
      })
      .catch(() => setStatus("ready")); // If check fails, still show the form
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("submitting");

    try {
      const res = await fetch("/api/owner/bootstrap", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, setupSecret }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setStatus("ready");
        return;
      }

      setStatus("done");
      // Redirect to owner dashboard after short delay
      setTimeout(() => setLocation("/admin/owner/dashboard"), 2000);
    } catch {
      setError("Network error — please try again");
      setStatus("ready");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 100%)" }}>
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)" }}>
            <Crown className="w-5 h-5" style={{ color: "#fbbf24" }} />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">Owner's Corner Setup</h1>
            <p className="text-white/40 text-xs">One-time activation</p>
          </div>
        </div>

        {/* Already done */}
        {status === "already-done" && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-white font-semibold">Owner account already activated</p>
            <p className="text-white/40 text-sm">Bootstrap has already been completed.</p>
            <button
              onClick={() => setLocation("/admin/owner/dashboard")}
              className="mt-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white transition-all"
              style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)" }}
            >
              Go to Owner's Corner
            </button>
          </div>
        )}

        {/* Checking */}
        {status === "checking" && (
          <div className="flex items-center justify-center gap-3 py-12 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Checking status…</span>
          </div>
        )}

        {/* Success */}
        {status === "done" && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-white font-semibold">Owner account activated!</p>
            <p className="text-white/40 text-sm">Redirecting you to Owner's Corner…</p>
          </div>
        )}

        {/* Form */}
        {(status === "ready" || status === "submitting") && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-2xl border border-white/8 p-5 space-y-4"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-white/50 text-sm leading-relaxed">
                Enter the email address you signed up with and the setup secret from your server environment to activate Owner's Corner for your account.
              </p>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                  Your account email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                </div>
              </div>

              {/* Setup secret */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                  Setup secret
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                  <input
                    type="password"
                    required
                    value={setupSecret}
                    onChange={(e) => setSetupSecret(e.target.value)}
                    placeholder="From OWNER_SETUP_SECRET env var"
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl p-3"
                  style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={status === "submitting"}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}
            >
              {status === "submitting" ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Activating…</>
              ) : (
                <><Crown className="w-4 h-4" /> Activate Owner's Corner</>
              )}
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
