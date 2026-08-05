import { useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { FcGoogle } from "react-icons/fc";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { supabase } from "@/lib/supabaseClient";
import { basePath } from "@/lib/basePath";

const inputClasses =
  "w-full h-11 rounded-lg bg-[#0f2035] border border-[#1e3a5f] text-white placeholder:text-[#7a8fa6] px-3.5 text-sm outline-none focus:border-[#00E676] transition-colors";

/**
 * Bare "/auth/redirect" path for wouter's `setLocation` — wouter's `Router base`
 * prop already handles the base path itself, so passing a base-prefixed path
 * here would double it up.
 */
function authRedirectPath(redirectUrl: string | null): string {
  const params = redirectUrl ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : "";
  return `/auth/redirect${params}`;
}

/**
 * Full absolute "/auth/redirect" URL (including origin + basePath) for
 * Supabase's OAuth `redirectTo` — this is a real browser navigation target,
 * not a wouter-internal one, so it does need the base path included.
 */
function authRedirectAbsoluteUrl(redirectUrl: string | null): string {
  return `${window.location.origin}${basePath}${authRedirectPath(redirectUrl)}`;
}

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const redirectUrl = new URLSearchParams(search).get("redirect_url");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      setLocation(authRedirectPath(redirectUrl));
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
        redirectTo: authRedirectAbsoluteUrl(redirectUrl),
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setGoogleLoading(false);
    }
    // On success the browser navigates away to Google, so no further state update needed.
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
        <p className="text-[#7a8fa6] text-sm">Sign in to your account</p>
      </div>

      <div className="bg-[#081526] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60 border border-[#1e3a5f] p-8">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClasses}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-[#ff4757]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-lg bg-[#00E676] hover:bg-[#14F195] text-black font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign In
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-[#7a8fa6]">
          Don't have an account?{" "}
          <Link href="/sign-up" className="text-[#00E676] hover:text-[#14F195]">
            Sign up
          </Link>
        </p>
      </div>

      <p className="mt-6 text-[#7a8fa6] text-sm text-center max-w-sm">
        By signing in you agree to our{" "}
        <Link href="/terms" className="text-[#00E676] hover:underline">Terms of Service</Link>
        {" "}and{" "}
        <Link href="/privacy" className="text-[#00E676] hover:underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
