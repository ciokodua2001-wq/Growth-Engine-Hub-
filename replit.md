# GrowthForge AI

AI-powered marketing OS SaaS by Strapli Technologies Inc. — turns any business website into a full AI marketing department with strategy, content, social, email, and video.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Auth: Clerk (Replit-managed, app_3GAO5duvU6bI7Y0N5ww2FwrFxlf) — email + Google
- Frontend: React + Vite + Wouter + Tailwind v4 + Framer Motion
- AI: Anthropic Claude (`claude-sonnet-4-6`) via Replit AI Integrations (`@workspace/integrations-anthropic-ai`)

## Where things live

- `lib/db/src/schema/` — DB schema (Drizzle): `users.ts`, `projects.ts`, `index.ts`
- `artifacts/api-server/src/` — Express API server
   - `app.ts` — Express app setup (middleware order critical: webhook → Clerk proxy → json → routes)
   - `lib/websiteFetcher.ts` — fetches + strips a live website's HTML down to plain text (timeout, size cap, throws `WebsiteFetchError` on failure)
   - `lib/aiJson.ts` — calls Claude and parses a strict-JSON response; used by analysis/personas/competitors/strategy routes and all content generators
   - `lib/projectContext.ts` — `getGroundingContext(projectId)` (null if business analysis isn't `"complete"`) + `renderGroundingBlock(ctx)`; the single source of "real business facts" fed into every AI generation call across the app
   - `lib/contentGenerators.ts` — shared AI generators (`generateSocialPosts`, `generateEmailCampaign`, `generateVideoBlueprints`, `generateAdCreatives`, `generateCompetitors`), each grounded via `GroundingContext`; used by both the direct REST routes and the Forge AI agent so behavior stays consistent
   - `routes/analysis.ts` — business analysis, personas, marketing strategy (all real AI, grounded in fetched website content)
   - `routes/competitors.ts` — competitor discovery + competitive report (real AI, grounded in business analysis)
   - `routes/content.ts` — social posts + email campaigns (real AI via `contentGenerators`, 409 if analysis not complete)
   - `routes/videos.ts` — video blueprints (real AI via `contentGenerators`, 409 if analysis not complete)
   - `routes/campaigns.ts` — performance reports (AI-grounded summary/recommendations; kpiTrends stay synthetic — no real ad platform integration) + Forge AI agent chat (two-call design: `classifyAgentIntent` picks chat vs. an action intent and pre-writes the reply, then `performAgentAction` does the real generation via `contentGenerators` before the reply is sent)
- `artifacts/growthforge/src/pages/` — Frontend pages
  - `sign-in.tsx`, `sign-up.tsx` — Clerk auth pages (dark theme)
  - `onboarding.tsx` — 3-step onboarding wizard (business info incl. website URL, goal, target market — industry is no longer asked, it's inferred by AI)
  - `analysis-progress.tsx` — runs the real analyze → competitors → personas → strategy pipeline sequentially against the API and shows live progress/errors (no fake timers)
  - `dashboard.tsx` — Main app dashboard with auth guard + UserButton
  - `landing.tsx` — Public landing page

## Architecture decisions

- Every project-scoped route enforces ownership: `projectsTable.ownerId` (nullable text FK → `users.id`) is set from the authenticated Clerk user on creation (both `POST /projects` and onboarding), and `artifacts/api-server/src/lib/authz.ts` provides `requireUserId()`/`loadOwnedProject()`/`requireProjectOwnershipParam()` — the latter wired once per router via `router.param("id", requireProjectOwnershipParam())` in `projects.ts`, `analysis.ts`, `competitors.ts`, `content.ts`, `videos.ts`, `campaigns.ts` (covers every nested `:id/...` route on that router automatically). Unauthenticated → 401; authenticated-but-not-owner → 404 (never leaks existence). `trial.ts` uses `:projectId` instead of `:id` so it does the same check manually inline. Admin routes (`routes/admin.ts`, `/admin/*`) are a separate namespace gated by `requireAdmin` and intentionally see all projects regardless of owner.
- `POST /projects` always forces `plan: "trial"` server-side (never trusts a client-supplied plan) so the trial AI-spend cap can't be bypassed by any project-creation path, matching what onboarding already did.

- Clerk proxy middleware must be registered before `express.json()` and before `clerkMiddleware()`.
- Auth guards use `useEffect` for redirects (not inline `setLocation()` during render).
- Business analysis is the source of truth for a project's industry — set by AI after reading the live website, not collected from the user during onboarding.
- If a project's website can't be fetched/analyzed, the business analysis is stored with `status: "failed"` (never fabricated data); personas/competitors/strategy generation are blocked until analysis is `"complete"`.
- Trial-plan usage is enforced server-side (not just advisory) via `trialUsageTable` + `consumeTrialQuota()` in `lib/trialLimits.ts`, gated with a row-level lock so concurrent requests can't double-spend quota. Enforcement only applies when `project.plan === "trial"`; exceeding a limit returns 403 before any work is done — and always *before* the AI call that would incur cost.
- **Trial AI spend cap: every AI-costing feature is capped so a single 14-day trial project's theoretical worst-case Claude spend stays ≤ $0.45.** Current limits (`TRIAL_LIMITS` in `lib/trialLimits.ts`): analysis 1x, competitors 2x, personas 1x, strategy 1x, competitor report 1x, social posts 5x (count-based), email campaigns 1x, video blueprints 1x (call-based, batch clamped to `TRIAL_MAX_VIDEO_BATCH` = 3 videos on trial plan regardless of requested count), ads 5x (count-based — capped even though the direct `/ads` route is still templated/free today, so it stays safe if ever wired to real AI), Forge AI messages 10x. Worst-case budget breakdown (~$0.37 total, conservative per-unit estimates at Claude Sonnet's $3/M-in $15/M-out pricing): analysis $0.03, personas $0.02, strategy $0.02, competitors $0.02/call × 2, competitor report $0.04, social posts $0.005/post × 5, email campaigns $0.02, video blueprints $0.03 (clamped batch), ads $0.005/ad × 5, agent messages $0.012/message × 10 (classification call only — when an action fires, its cost is already covered by that feature's own quota above, not additive). **Any new AI-costing feature must get its own `TRIAL_LIMITS` entry and be re-checked against this $0.45 budget.**
- `GET /competitor-report` never calls AI — it only reads the cached `competitorReportTable` row (populated by `POST /competitor-report`), preventing unbounded AI cost from repeated page views.
- All AI content generation (social posts, emails, videos, ads, competitors, agent chat, reports) is grounded via `getGroundingContext()` — never fabricated from scratch. Any endpoint that would generate content for a project with incomplete business analysis returns 409 (or, for agent chat, a "run analysis first" reply) instead of producing generic/ungrounded output.
- Forge AI chat quota is two-layered: every message consumes the flat `agent_messages` quota, and if the AI classifies the message as an action (competitors/social_posts/emails/videos/ads), the specific feature's own trial quota (e.g. `video_blueprints`, `ads`) is also consumed before generating — closing a bypass where chat could otherwise produce unlimited content under just the message cap.

## Product

- Landing page at `/` — marketing/hero for GrowthForge AI
- `/sign-up` / `/sign-in` — Clerk auth with Google + email
- `/onboarding` — Business setup wizard (auth required)
- `/dashboard` — Project list with AI marketing actions (auth required)

## Branding

- Background: `#040B14` | Primary: `#00E676` | Secondary: `#00D4FF` | Accent: `#14F195` | Text: `#FFFFFF`
- Company: Strapli Technologies Inc. | Product: GrowthForge AI | Domain: UseGrowthForge.com

## User preferences

- Keep auth pages branded as "GrowthForge" not generic Clerk branding
- All auth-required routes redirect to `/sign-in` (not `/`)

## Gotchas

- Do not run `pnpm dev` at workspace root — use individual workflow restarts

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- - See `.local/skills/clerk-auth/SKILL.md` for Clerk setup guide
