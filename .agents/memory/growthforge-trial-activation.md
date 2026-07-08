---
name: GrowthForge trial activation trigger
description: When a user/project's subscriptionStatus actually becomes "trial" — relevant for testing anything gated on trial status (e.g. TrialStatusPanel, trial quotas).
---

`subscriptionStatus` on the `users` row is only flipped to `"trial"` when the user visits `/plans` and clicks "Start Free Trial" (which calls `/api/auth/provision` then `/api/auth/start-trial`), *before* they go through `/onboarding`. Signing up and completing onboarding directly does **not** provision a `users` row or set trial status.

**Why:** discovered while e2e-testing a mobile sidebar layout fix — fresh Clerk test accounts that skipped `/plans` never got a `users` row at all (`/api/auth/me` 404s), so anything gated on `subscriptionStatus === "trial"` (e.g. `TrialStatusPanel`) silently never rendered, even though the project itself was created fine.

**How to apply:** when writing a test plan (or manually verifying) anything that depends on trial status/quota, route through `/plans` → "Start Free Trial" → `/onboarding` first. Don't assume a freshly signed-up account is on trial.
