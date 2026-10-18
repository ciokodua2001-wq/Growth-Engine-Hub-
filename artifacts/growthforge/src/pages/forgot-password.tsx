import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Loader2, MailCheck, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { authClient } from "@/lib/authClient";

const inputClasses =
  "w-full h-11 rounded-lg bg-[#0f2035] border border-[#1e3a5f] text-white placeholder:text-[#7a8fa6] px-3.5 text-sm outline-none focus:border-[#00E676] transition-colors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: resetErr } = await authClient.forgetPassword({
        email,
        redirectTo: "/reset-password",
      });
      if (resetErr) {
        setError(resetErr.message ?? "Failed to send reset link");
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: "#040B14" }}>
      <div className="mb-8 flex flex-col items-center gap-3">
        <Link href="/" className="flex items-center gap-3 mb-2">
          <Logo size={52} />
          <span className="text-xl font-bold text-white">GrowthForge</span>
        </Link>
        <p className="text-[#7a8fa6] text-sm">Reset your password</p>
      </div>

      <div className="bg-[#081526] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60 border border-[#1e3a5f] p-8">
        {sent ? (
          <div className="text-center py-4 space-y-3">
            <div className="h-14 w-14 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mx-auto">
              <MailCheck className="h-7 w-7 text-[#00E676]" />
            </div>
            <h2 className="text-lg font-bold text-white">Check your email</h2>
            <p className="text-sm text-[#7a8fa6]">
              If an account exists for <span className="text-white">{email}</span>, we sent a password reset link.
            </p>
            <div className="pt-4">
              <Link href="/sign-in" className="text-sm text-[#00E676] hover:underline flex items-center justify-center gap-1">
                <ArrowLeft className="h-4 w-4" /> Back to Sign In
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[#a8b8cc] text-sm mb-1.5 block">Email address</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClasses}
                placeholder="you@company.com"
              />
            </div>

            {error && <p className="text-sm text-[#ff4757]">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-[#00E676] hover:bg-[#14F195] text-black font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Reset Link
            </button>

            <p className="pt-2 text-center text-sm text-[#7a8fa6]">
              Remember your password?{" "}
              <Link href="/sign-in" className="text-[#00E676] hover:text-[#14F195]">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
