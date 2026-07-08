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

- Clerk proxy middleware must be registered before `express.json()` and before `clerkMiddleware()`.
- Auth guards use `useEffect` for redirects (not inline `setLocation()` during render).
- Business analysis is the source of truth for a project's industry — set by AI after reading the live website, not collected from the user during onboarding.
- If a project's website can't be fetched/analyzed, the business analysis is stored with `status: "failed"` (never fabricated data); personas/competitors/strategy generation are blocked until analysis is `"complete"`.
- Trial-plan usage is enforced server-side (not just advisory) via `trialUsageTable` + `consumeTrialQuota()` in `lib/trialLimits.ts`, gated with a row-level lock so concurrent requests can't double-spend quota. Enforcement only applies when `project.plan === "trial"`; exceeding a limit returns 403 before any work is done — and always *before* the AI call that would incur cost. Covers all 9 features on the trial pricing card: analysis 1x, competitors 3x, personas 1x, strategy 1x, competitor report 3x (all call-based — the 5 AI-costing endpoints), plus social posts 5x (count-based, tracks actual posts generated), email campaigns 1x, video blueprints 1x (both call-based — one generation event, regardless of how many items it produces, matching "1 Email Campaign" / "1 Video Blueprint" wording), and Forge AI messages 25x (per user message sent to agent chat). All of these — social posts, emails, videos, competitors, ads, and agent chat — now call real Claude AI via `contentGenerators.ts`, grounded in the project's business context; nothing is templated.
- `GET /competitor-report` never calls AI — it only reads the cached `competitorReportTable` row (populated by `POST /competitor-report`), preventing unbounded AI cost from repeated page views.
- All AI content generation (social posts, emails, videos, ads, competitors, agent chat, reports) is grounded via `getGroundingContext()` — never fabricated from scratch. Any endpoint that would generate content for a project with incomplete business analysis returns 409 (or, for agent chat, a "run analysis first" reply) instead of producing generic/ungrounded output.
- Forge AI chat quota is two-layered: every message consumes the flat `agent_messages` quota, and if the AI classifies the message as an action (competitors/social_posts/emails/videos), the specific feature's own trial quota (e.g. `video_blueprints`) is also consumed before generating — closing a bypass where chat could otherwise produce unlimited content under just the message cap. "Ads" has no trial quota (not on the pricing card, matching the direct `/ads` route), so agent-triggered ad generation skips the sub-quota check.

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
