import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { FcGoogle } from "react-icons/fc";
import { Loader2, MailCheck } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { supabase } from "@/lib/supabaseClient";
import { basePath } from "@/lib/basePath";

const inputClasses =
  "w-full h-11 rounded-lg bg-[#0f2035] border border-[#1e3a5f] text-white placeholder:text-[#7a8fa6] px-3.5 text-sm outline-none focus:border-[#00E676] transition-colors";

export default function SignUpPage() {
  const [, setLocation] = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${basePath}/auth/redirect` },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        // Email confirmation is disabled — the user is already signed in.
        // Bare path: wouter's Router base already handles basePath, unlike the
        // absolute emailRedirectTo/redirectTo URLs above which need it explicitly.
        setLocation("/plans");
      } else {
        // Confirmation email sent; the user must click the link before a session exists.
        setAwaitingConfirmation(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${basePath}/auth/redirect`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setGoogleLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "#040B14" }}
    >
      <div className="mb-8 flex flex-col items-center gap-3">
        <Link href="/" className="flex items-center gap-3 mb-2">
          <Logo size={52} />
          <span className="text-xl font-bold text-white">GrowthForge</span>
        </Link>
        <p className="text-[#7a8fa6] text-sm">Create your free account</p>
      </div>

      <div className="bg-[#081526] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60 border border-[#1e3a5f] p-8">
        {awaitingConfirmation ? (
          <div className="text-center py-4 space-y-3">
            <div className="h-14 w-14 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center mx-auto">
              <MailCheck className="h-7 w-7 text-[#00E676]" />
            </div>
            <h2 className="text-lg font-bold text-white">Check your email</h2>
            <p className="text-sm text-[#7a8fa6]">
              We sent a confirmation link to <span className="text-white">{email}</span>. Click it to
              finish creating your account.
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full h-11 rounded-lg bg-[#0f2035] border border-[#1e3a5f] hover:bg-[#1e3a5f] text-white text-sm font-medium flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
            >
              {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FcGoogle className="h-4 w-4" />}
              Continue with Google
            </button>

            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-[#1e3a5f]" />
              <span className="text-xs text-[#7a8fa6]">or</span>
              <div className="h-px flex-1 bg-[#1e3a5f]" />
            </div>

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
              <div>
                <label className="text-[#a8b8cc] text-sm mb-1.5 block">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClasses}
                  placeholder="At least 8 characters"
                />
              </div>

              {error && <p className="text-sm text-[#ff4757]">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-lg bg-[#00E676] hover:bg-[#14F195] text-black font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Account
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-[#7a8fa6]">
              Already have an account?{" "}
              <Link href="/sign-in" className="text-[#00E676] hover:text-[#14F195]">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>

      <p className="mt-6 text-[#7a8fa6] text-sm text-center max-w-sm">
        By signing up you agree to our{" "}
        <Link href="/terms" className="text-[#00E676] hover:underline">Terms of Service</Link>
        {" "}and{" "}
        <Link href="/privacy" className="text-[#00E676] hover:underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
