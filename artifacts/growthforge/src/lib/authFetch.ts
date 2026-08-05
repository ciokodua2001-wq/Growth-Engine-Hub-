import { supabase } from "./supabaseClient";

let installed = false;

/**
 * Patches the global `fetch` so every same-origin `/api/*` request
 * automatically carries `Authorization: Bearer <supabase-access-token>`.
 *
 * Replaces Clerk's cookie-based session, which the server read directly off
 * the request without any client-side wiring. Supabase's browser client
 * keeps its session in localStorage instead, so the token has to be attached
 * explicitly — this patch does it in exactly one place instead of touching
 * every one of the ~30 call sites that call `fetch("/api/...")` directly
 * (plus the generated `@workspace/api-client-react` hooks, which also just
 * call the global `fetch`).
 *
 * Must run once, before the app renders (see main.tsx) — call `installAuthFetch()`.
 */
export function installAuthFetch(): void {
  if (installed) return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (!isSameOriginApiRequest(input)) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));

    if (!headers.has("authorization")) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.set("authorization", `Bearer ${token}`);
    }

    return nativeFetch(input, { ...init, headers });
  };
}

/**
 * Resolves `input` against the current origin (so relative paths, including
 * ones with `..` segments, are handled the same as an absolute URL would be)
 * and checks whether it targets same-origin `/api/*`.
 */
function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const resolved = new URL(raw, window.location.origin);
    return resolved.origin === window.location.origin && resolved.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}
