---
name: Clerk role-based post-login redirect
description: How this app routes users to /admin vs /dashboard after Clerk sign-in, and how to add admin affordances to Clerk's UserButton.
---

Pattern used for role-based redirect after Clerk sign-in:
- Point Clerk's `signInFallbackRedirectUrl` at an intermediate route (e.g. `/auth/redirect`) instead of a fixed page.
- That route fetches the current user's role (via a shared hook wrapping `/api/auth/me`) and routes to `/admin` for admin/super_admin, `/dashboard` otherwise, falling back to `/dashboard` on fetch error and to `/sign-in` if unauthenticated.
- For persistence (admin revisiting `/` or `/dashboard` later in the session), add a `useEffect` redirect guard on those pages too — the fallback URL alone only fires once, right after sign-in.

Clerk's `UserButton` supports compound components for custom menu items: `<UserButton><UserButton.MenuItems><UserButton.Link label=... href=... labelIcon={...} /></UserButton.MenuItems></UserButton>` (confirmed working on `@clerk/react` ^6.11.3).

**Why:** Clerk's static fallback redirect URLs can't branch on app-specific role data fetched from your own API, and they only fire once at sign-in, not on every visit.

**How to apply:** Any time you need post-auth routing that depends on data outside Clerk's session claims (role, plan, onboarding status), use the intermediate-redirect-page pattern rather than trying to encode logic into Clerk's fallback URL config.
