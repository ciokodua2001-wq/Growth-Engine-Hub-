import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

/**
 * Browser Supabase client (anon key — safe to expose). Manages the session
 * in localStorage and handles token refresh automatically. Replaces Clerk's
 * `<ClerkProvider>` as the source of truth for auth state (see
 * contexts/auth-context.tsx).
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Start Google OAuth and return the provider URL (caller must navigate). */
export async function googleOAuthUrl(redirectTo: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
  if (!data.url) {
    throw new Error("Google sign-in did not return a redirect URL. Try email and password.");
  }
  return data.url;
}
