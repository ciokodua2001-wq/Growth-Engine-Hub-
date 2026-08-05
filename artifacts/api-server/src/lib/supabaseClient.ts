import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared Supabase admin client, authenticated with the service role key.
 * Used for both object storage (bypassing RLS) and server-side auth-token
 * verification (`auth.getUser(token)`). Centralized here so both concerns
 * pull from a single client instance instead of each constructing their own.
 */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. The server cannot initialize without them.",
  );
}

export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
