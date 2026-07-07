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

## Where things live

- `lib/db/src/schema/` — DB schema (Drizzle): `users.ts`, `projects.ts`, `index.ts`
- `artifacts/api-server/src/` — Express API server
   - `app.ts` — Express app setup (middleware order critical: webhook → Clerk proxy → json → routes)
- `artifacts/growthforge/src/pages/` — Frontend pages
  - `sign-in.tsx`, `sign-up.tsx` — Clerk auth pages (dark theme)

  - `onboarding.tsx` — 4-field onboarding wizard
  - `dashboard.tsx` — Main app dashboard with auth guard + UserButton
  - `landing.tsx` — Public landing page

## Architecture decisions


- Clerk proxy middleware must be registered before `express.json()` and before `clerkMiddleware()`.
- Auth guards use `useEffect` for redirects (not inline `setLocation()` during render).

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
