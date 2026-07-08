---
name: Clerk protected-page auth guard race
description: Why a protected page can show a permanent "signed out" / 401 error even for a genuinely signed-in user, and how to guard against it.
---

Any page that fetches data protected by `getAuth`/`requireAuth` must gate the fetch (and ideally the whole page render) on Clerk's `isLoaded` before checking `isSignedIn`, not just render immediately and let the query fire.

**Why:** `useUser()`/`useAuth()` start with `isLoaded: false` while Clerk restores the session from the cookie. If a page's data-fetching hook (e.g. a `useQuery`) has no `enabled`/guard tied to `isLoaded`, it fires on first render — before the session is restored — and gets a 401 even though the user is properly signed in. Since most queries only retry once, this produces a permanent-looking "access denied" error that persists until a lucky reload, misleading users (and agents) into thinking auth/roles are broken when it's actually just a load-order race.

**How to apply:** In any auth-gated page/layout: show a loading state while `!isLoaded`; once loaded, redirect to sign-in if `!isSignedIn`; only render children (and let their data queries fire) once both `isLoaded` and `isSignedIn` are true. Don't rely on `isSignedIn` alone.
