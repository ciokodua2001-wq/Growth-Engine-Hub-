---
name: GrowthForge pre-existing typecheck debt
description: Known pre-existing TypeScript errors in growthforge/api-server unrelated to feature work — don't chase them as regressions.
---

As of 2026-07-08, `pnpm run typecheck` fails on two clusters of errors that predate the AI-analysis rewrite (business analysis/personas/competitors/strategy going from hardcoded to real Claude calls):

1. `artifacts/api-server/src/routes/admin.ts` — several `string | string[]` vs `string` mismatches (likely `req.query` values used without narrowing) and a `.userId` access on a table missing that column.
2. Across most of `artifacts/growthforge/src/pages/project/*.tsx` and `project-layout.tsx` — `useQuery`/generated-hook calls pass `{ query: { enabled: ... } }` without `queryKey`, which the current `@tanstack/react-query` types require.

**Why:** confirmed via `git diff` that none of these files were touched during the AI-analysis overhaul; they fail identically before and after. Worth knowing so a future session doesn't waste time assuming a new change broke them, and so a dedicated cleanup pass can be scoped separately.

**How to apply:** when `pnpm run typecheck` fails, check `git --no-optional-locks diff --stat` first — if the failing file isn't one you touched, it's likely this pre-existing debt, not a regression from your change.
