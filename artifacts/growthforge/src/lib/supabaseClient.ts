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
