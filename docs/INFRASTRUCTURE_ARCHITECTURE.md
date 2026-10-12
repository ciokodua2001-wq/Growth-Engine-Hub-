# GrowthForge - Cost-First Infrastructure Architecture

**Goal:** lowest responsible cost at launch, with an incremental path to scale -
no enterprise infrastructure before enterprise traffic, and no rewrite at any stage.

**Constraint:** preserve all completed Business/Creator/Hybrid functionality and the
Nigeria (`en-NG`) localization. This document is analysis + design only - nothing here
provisions, purchases, or changes live infrastructure.

> Pricing below is approximate (2026) and must be re-checked at provisioning time. It is
> organized so the *decision* (what to use at each stage) survives minor price drift.

---

## 0. Executive summary

| Layer | Stage A (launch) | Stage B (growth) | Stage C (scale) |
|---|---|---|---|
| Compute | 1× Lightsail **Small $10/mo** (2GB) | 2× Lightsail ($10 app + $10 DB) | 3+ app nodes + LB + managed DB |
| Database | **PostgreSQL on the Lightsail box** | dedicated PG box **or** Lightsail managed PG | **RDS** (HA + read replica) |
| Auth | self-hosted **better-auth** ($0) *or* re-created Supabase Auth | same | same |
| Media storage | **Cloudflare R2** ($0 egress) | R2 + lifecycle | R2 + Cloudflare CD |
| Fixed cost | **~$12/mo** | ~$35-55/mo | ~$150-400/mo |
| Variable cost | per-use AI + video (tracked, capped) | per-use + queues | per-use + cache |

The single most important recommendation: **do not re-buy a managed Postgres or re-create
Supabase at launch.** Run PostgreSQL on the same Lightsail box (upgraded from the current
$5 Nano to a $10 2GB Small), back it up nightly to object storage, and self-host a small
OSS auth. That is the cheapest architecture that is still secure and recoverable, and it
upgrades cleanly to managed services later without a rewrite.

---

## 1. Current-state audit (what exists today)

From `docs/deployment.md`, `scripts/deploy/*`, and the repo config:

- **1× AWS Lightsail `Nano`, $5/mo** - 512 MB RAM, 1 vCPU, 20 GB SSD, region `ca-central-1`.
  Runs Ubuntu 24.04, Node 24, pnpm, **ffmpeg/ffprobe**, **Caddy** (auto-HTTPS), UFW.
- **Two api-server processes** (dev `:4001` + prod `:4002`) as systemd units, behind Caddy,
  routed by hostname (`dev.usegrowthforge.com` gated vs `usegrowthforge.com`). Dev/prod are
  separate git checkouts (`/home/ubuntu/{dev,prod}/app`) promoted blue-green.
- **Domain** `usegrowthforge.com` + `dev.` subdomain; Caddy auto-provisions TLS.
- **Supabase** (Postgres + Auth + Storage) - **DELETED** (billing/dunning → "Supabase exit").
  This is the current production blocker; see `docs/DEPLOYMENT_REGISTER.md` Stage 5.
- **Video pipeline:** Wan 2.2 rendering on Vast.ai / RunPod GPU (variable), ffmpeg assembly
  on the Lightsail box, S3-compatible upload path to Supabase Storage.
- **AI:** Google Gemini (Gemini Developer API). **Billing:** Stripe.
- **Storage code:** general objects use the Supabase **JS SDK** (`objectStorage.ts`); the
  video renderer uses an **S3-compatible** path (`wanRenderer.ts`).
- **Auth code:** `supabaseAuth.ts` → `supabase.auth.getUser(token)` (network call to
  Supabase Auth), frontend via `@supabase/supabase-js`.
- **CI/deploy:** GitHub remote; **no GitHub Actions**. A legacy Replit `postMerge` hook runs
  `scripts/post-merge.sh` → `pnpm --filter db push` - **this only fires on Replit, not on
  GitHub push.** A push to `origin/main` does **not** deploy or migrate anything.

**Known production gotchas already captured in `docs/deployment.md`:**
the Nano cannot run `vite build` on-box (OOM) - build the frontend locally and `scp`
`artifacts/growthforge/dist/public`. This is another reason Stage A should upgrade past Nano.

**Audit conclusion:** the app is a single-tenant monolith on one box; its only external
dependencies are the (deleted) Supabase project and the variable GPU/AI providers. Recovering
means choosing a new database + auth + storage - the subject of the next three sections.

---

## 2. Database comparison

### 2.1 Options

| Option | Monthly | Capacity | Reliability | Security | Backup/recovery | Ops effort | Upgrade path |
|---|---|---|---|---|---|---|---|
| **A. PostgreSQL on the existing Lightsail box** | +$0 (but Nano→**Small $10** to fit) | shares 2 GB | single box; app crash ≠ DB crash but same host | local socket / localhost, UFW blocks 5432 | `pg_dump` nightly → B2/R2 | low | resize box; later → dedicated/managed |
| **B. PostgreSQL on a small dedicated Lightsail instance** | +$7-10/mo (Micro 1GB or Small 2GB) | 1-2 GB isolated | DB survives app/ffmpeg OOM | private network (Lightsail VPC peering) or TLS+ufw | `pg_dump` + WAL archiving | moderate (2 boxes) | resize; later → managed/RDS |
| **C. Lightsail managed PostgreSQL** | **$15/mo** (1 GB, 40 GB SSD, 100 GB transfer) | managed, auto-patch | AWS-managed, snapshots | managed, TLS | **automatic snapshots + PITR** | lowest | scale tier ($30/60); later → RDS |
| **D. Amazon RDS PostgreSQL** | **~$18-25/mo** (t4g.micro/small + storage) | 1-2 GB | Multi-AZ optional | VPC + IAM + TLS | automatic snapshots + PITR | low | read replicas, HA, proxy |

### 2.2 Recommendation

- **Stage A → Option A.** One Lightsail **Small ($10/mo, 2 GB)** running Postgres + the app
  + Caddy + ffmpeg. A 2 GB box comfortably hosts Postgres (~300 MB shared_buffers) plus one
  api-server. This is the cheapest secure option, and it removes the current Nano OOM risk
  for both the build step and Postgres. Reliability is covered by **nightly `pg_dump` to
  object storage + a documented restore drill** - not by paying for HA nobody needs yet.
- **Stage B → Option B or C.** When there are paying customers, move Postgres to its own
  box ($10) or to Lightsail managed PG ($15) to get automatic snapshots and isolate the DB
  from app/ffmpeg memory pressure. Prefer **Option C ($15 managed)** - the small premium
  buys automatic backups/PITR and removes the largest operational risk for ~$5/mo.
- **Stage C → Option D (RDS).** When high availability, read replicas, and connection
  pooling become justified. `db.t4g.small` + a read replica, or Aurora Serverless v2 if
  traffic is spiky. Do this only when Stage B's managed PG becomes the bottleneck.

**Why not RDS/Cognito-scale from day one:** a single-box Postgres with real backups is
appropriate until hundreds of concurrent customers; paying for Multi-AZ/read replicas before
there is traffic is exactly the over-engineering to avoid.

---

## 3. Authentication comparison

Requirement: email/password, Google OAuth, team invitations, account recovery - all of which
the app already expects via `supabaseAuth.ts`.

| Option | Monthly | Complexity | Supports the 4 requirements | Notes |
|---|---|---|---|---|
| **Amazon Cognito** | $0 up to 50k MAU, then per-MAU | **High** (user pools, app clients, Lambda triggers, custom federation) | yes, but each is a chore | Reject - most operational burden, least benefit here |
| **Re-create Supabase Auth** | **$25/mo** Pro (free tier pauses after 1 wk) | **Zero** (code already integrates) | yes, natively | Fastest to live, but reintroduces the vendor that just deleted our data |
| **better-auth (self-hosted OSS)** | **$0** | Moderate (one-time integration) | yes (email/password, Google OAuth, orgs/invites, password reset) | Runs in the api-server; users stored in our own Postgres |
| **Custom minimal JWT** | $0 | Highest | built by hand | Most control, most risk - only if better-auth is insufficient |

### 3.1 Recommendation

- **Stage A → better-auth (self-hosted, $0).** It covers every requirement natively, stores
  users in the same Postgres we already run, has no per-seat/per-MAU cost, and removes the
  single-vendor failure that just took down the platform. Replace `supabaseAuth.ts` with a
  small `better-auth` handler that issues JWTs verified with the existing `TOKEN_ENCRYPTION_KEY`
  (or a dedicated `AUTH_SECRET`), and swap the frontend sign-in calls.
- **Fastest-to-live alternative (acceptable):** re-create a Supabase project for Auth only.
  This is ~0 code change and gets the platform live fastest, at **$25/mo** + vendor risk.
  Choose this only if "live this week" outranks "lowest recurring cost."
- **Cognito: not recommended.** It solves nothing this app needs that the above two don't,
  and adds the highest ongoing complexity.

---

## 4. Storage comparison (AI video + bandwidth focused)

| Option | Storage | Egress | Notes |
|---|---|---|---|
| **Amazon S3** | $0.023/GB-mo | **$0.09/GB** (100 GB free) | Egress is the problem for video; familiar but not cheapest |
| **Cloudflare R2** | $0.015/GB-mo (10 GB free) | **$0 egress** | Best for bandwidth-heavy media; S3-compatible |
| **Backblaze B2** | **$0.006/GB-mo** | $0 via Cloudflare (Bandwidth Alliance) | Cheapest storage + free egress when fronted by CF |
| **Supabase Storage** | bundled, $25/mo Pro | bundled | Deleted; tied to Supabase |

### 4.1 Recommendation

- **Stage A → Cloudflare R2** (or B2 fronted by Cloudflare). AI-generated video is large and
  egress-heavy, so **$0 egress** is the deciding factor. R2/B2 are S3-compatible, so the
  existing `wanRenderer.ts` S3 path re-points with only an endpoint + key change. The
  `objectStorage.ts` Supabase-JS calls need a small migration to an S3 client (or keep a
  minimal Supabase-compatible shim) - bounded, one-time work.
- **Stage B →** add **lifecycle rules** (delete or cold-tier rendered assets after N days).
- **Stage C →** put R2 behind the Cloudflare CDN for caching + delivery optimization.

---

## 5. Three-stage architecture and cost model

### 5.1 Stage A - Launch (~10-50 customers, low traffic)

```
                       Internet
                          │
                    Caddy :80/:443 (TLS)
                          │
        ┌─────────────────┴──────────────────┐
        │  ONE Lightsail Small $10/mo (2GB)  │
        │   * Postgres (local, ufw-blocked)  │
        │   * api-server (prod, :4002)       │
        │   * static frontend (dist/public)  │
        │   * better-auth (in api-server)    │
        │   * ffmpeg assembly                │
        └──────────────┬─────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        │  Cloudflare R2 (media, $0 egress)  │   + nightly pg_dump → R2
        │  Google Gemini (variable)          │
        │  Vast.ai / RunPod GPU (variable)   │
        │  Stripe (billing)                  │
        └────────────────────────────────────┘
```

**Fixed monthly cost (Stage A):**

| Item | Cost |
|---|---|
| Lightsail Small (2 GB) | $10.00 |
| Domain (`usegrowthforge.com`) | ~$1.00 |
| R2 storage (media + backups, ~10-50 GB) | $0-0.75 |
| Monitoring (UptimeRobot/Betterstack free) | $0 |
| **Fixed subtotal** | **~$11-12/mo** |

**Variable monthly cost (Stage A, per-use, assumed ~200 analyses + 1,000 content pieces +
50 short videos):**

| Item | Assumption | Estimate |
|---|---|---|
| Gemini (analysis/content) | ~$0.05-0.20 per call | $20-60 |
| Wan 2.2 GPU rendering | ~$0.02-0.05/sec of video | $30-100 |
| **Variable subtotal** | usage-driven | **~$50-160/mo** |

> Fixed and variable are deliberately separated: the fixed ~$12/mo is the floor; the
> variable is fully controllable via the caps in §6.

### 5.2 Stage B - Growth (hundreds-thousands of active customers)

- **Compute:** split into app ($10) + dedicated DB ($10), or app ($10) + **Lightsail managed
  PG ($15)** - recommended for auto-backups/PITR.
- **Workers:** move long jobs (video assembly, bulk content, email) to a queue (BullMQ +
  Redis, or Upstash) so the API stays responsive.
- **Monitoring:** Betterstack/Sentry free tier; Lightsail metrics + a `/api/healthz` poll.
- **Storage:** R2 + lifecycle rules; retain backups 30 days.

**Fixed monthly cost (Stage B):** app $10 + managed PG $15 + R2 ~$5 + monitoring $0-20 ≈
**$30-50/mo.** (Variable AI/video scales with customers, still capped per §6.)

### 5.3 Stage C - Scale (larger base, HA when justified)

- **Compute:** 2-3 api-server nodes behind a Lightsail load balancer ($18/mo) or an
  auto-scaling group; separate worker pool.
- **Database:** RDS `db.t4g.small` (~$23/mo) + Multi-AZ/read replica only when 99.9% uptime
  is a real requirement; add a connection pooler.
- **Queue/cache:** managed Redis (ElastiCache/Upstash) for queues + caching.
- **Media:** Cloudflare CDN in front of R2.

**Fixed monthly cost (Stage C):** LB $18 + 3× app $30 + RDS(+HA) $50-120 + Redis $15-30 +
CDN $0-25 ≈ **$150-400/mo** - reached incrementally, only as each previous stage saturates.

---

## 6. Preventing surprise bills

1. **Per-plan generation caps** (hard limits, not soft): analyses, content pieces, videos,
   and ads per day/month. The app already has `platformCredits.ts` + `plan` gating - extend
   them to enforce ceilings, not just deduct credits.
2. **Global spend kill-switch:** a config value (`AI_SPEND_CAP_USD`, `VIDEO_SPEND_CAP_USD`)
   that, when exceeded, returns a graceful "limit reached" instead of calling the provider.
3. **Provider-side caps + alerts:** Google Cloud budget alerts on the Gemini API; Vast.ai /
   RunPod **spend limits** and instance auto-stop; AWS Budgets ($0) on Lightsail/R2; Stripe
   balance/revenue alerts.
4. **Storage lifecycle policies:** R2 lifecycle to delete or cold-tier rendered videos and
   transient uploads after N days; cap per-user upload size and count.
5. **Per-customer cost tracking:** attribute each Gemini call and render job to a project
   (`platformCredits` already tracks tokens per AI call - extend the same pattern to video
   seconds and egress), and expose a per-project usage/cost view. This makes overage billing
   possible later and catches a single heavy user before they cost real money.
6. **Rate limiting** on the generation endpoints (per-user + per-project) to bound burst cost.

---

## 7. Migration note (Supabase exit) - preserving functionality + Nigeria

- **Auth:** replace `supabaseAuth.ts` (`supabase.auth.getUser`) with better-auth (or
  re-created Supabase Auth). All existing ownership/quota middleware stays intact.
- **Database:** re-apply the Drizzle schema to the new Postgres. Generate `0000_baseline`
  from a clean schema, then apply `0001_p0_creator_sources.sql` via `drizzle-kit migrate`
  (never `db push`). The schema already carries all Stage 1-4 columns, so **Business /
  Creator / Hybrid onboarding and the `en-NG` locale work unchanged**.
- **Storage:** re-point `wanRenderer.ts` to R2/B2 (S3-compatible, endpoint+keys only) and
  migrate `objectStorage.ts` off the Supabase JS SDK.
- **Config:** the `SUPABASE_*` and S3 keys in `.env` must be replaced with new providers'
  values. `TOKEN_ENCRYPTION_KEY` must remain a 64-char hex string (see `deployment.md`).

---

## 8. Register / next steps

This design is tracked here and will be mirrored into `docs/DEPLOYMENT_REGISTER.md` under
Stage 5 (production recovery). The next decision required from the owner is the **recovery
path** (recover vs. re-create the database) and the **auth provider** (self-hosted
better-auth vs. re-created Supabase Auth). No services are provisioned and nothing is
deployed until that is approved.
