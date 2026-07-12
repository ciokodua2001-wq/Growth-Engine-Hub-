---
name: Plan-tier quota enforcement
description: How paid-plan monthly quotas work alongside trial lifetime quotas; key design decisions.
---

## The rule

`consumeQuota()` in `lib/planLimits.ts` is the single entry point for all quota checks.
- `plan === "trial"` → delegates to `consumeTrialQuota()` (lifetime, `trialUsageTable`)
- paid plans (starter/get-going/growth/agency) → monthly, `planUsageTable`, resets by UTC calendar month (`currentPeriodStart()`)
- unknown/custom plan → passes (fail-open)

**Why:** Trial quotas are lifetime caps (spend control); paid quotas are monthly entitlements (subscription value). Keeping them in separate tables lets both coexist cleanly and avoids breaking existing trial enforcement.

**How to apply:** Any new AI-costing route must call `consumeQuota()`, not `consumeTrialQuota()`. If adding a feature only to paid plans (e.g. video rendering minutes), add it to `PLAN_LIMITS` but not `TRIAL_LIMITS`.

## Project count limits

Enforced at `POST /projects` in `routes/projects.ts`. Uses the "best plan" heuristic: highest tier across all of the user's non-deleted projects. This is temporary until Stripe puts plan on the user record.

Plan tier order: trial < starter < get-going < growth < agency

Limits: trial=1, starter=1, get-going=3, growth=6, agency=20.

## Plan limits source

`PLAN_LIMITS` in `lib/planLimits.ts` is derived from the pricing cards in `artifacts/growthforge/src/pages/plans.tsx`. Keep them in sync when pricing changes.

## `getQuotaUsage(projectId)`

Returns `{ plan, periodStart, usage }` — suitable for a frontend quota-usage panel. Not yet wired to an API endpoint.
