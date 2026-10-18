import { useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/authClient";

const inputClasses =
  "w-full h-11 rounded-lg bg-[#0f2035] border border-[#1e3a5f] text-white placeholder:text-[#7a8fa6] px-3.5 text-sm outline-none focus:border-[#00E676] transition-colors";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") || new URLSearchParams(search).get("error_description") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (!token) {
      setError("Invalid or missing reset token. Please request a new password reset.");
      return;
    }

    setLoading(true);
    try {
      const { error: resetErr } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (resetErr) {
        setError(resetErr.message ?? "Failed to reset password");
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
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
        <p className="text-[#7a8fa6] text-sm">Set your new password</p>
      </div>

      <div className="bg-[#081526] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60 border border-[#1e3a5f] p-8">
        {success ? (
          <div className="text-center py-4 space-y-3">
            <div className="h-14 w-14 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-7 w-7 text-[#00E676]" />
            </div>
            <h2 className="text-lg font-bold text-white">Password reset complete</h2>
            <p className="text-sm text-[#7a8fa6]">Your password has been updated. You can now sign in with your new password.</p>
            <div className="pt-4">
              <button
                onClick={() => setLocation("/sign-in")}
                className="w-full h-11 rounded-lg bg-[#00E676] hover:bg-[#14F195] text-black font-semibold text-sm transition-colors"
              >
                Sign In Now
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[#a8b8cc] text-sm mb-1.5 block">New Password</label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
                minLength={8}
                className={inputClasses}
              />
            </div>

            <div>
              <label className="text-[#a8b8cc] text-sm mb-1.5 block">Confirm New Password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                required
                minLength={8}
                className={inputClasses}
              />
            </div>

            {error && <p className="text-sm text-[#ff4757]">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-[#00E676] hover:bg-[#14F195] text-black font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Reset Password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
