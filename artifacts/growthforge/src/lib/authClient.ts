import { createAuthClient } from "better-auth/react";

/**
 * Better Auth browser client (cookie-based sessions) - replaces the Supabase
 * JS client. The server sets the `better-auth.session_token` cookie at
 * `/api/auth/*`, so same-origin API calls carry the session automatically
 * (no Bearer-token wiring needed).
 */
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || window.location.origin,
});
