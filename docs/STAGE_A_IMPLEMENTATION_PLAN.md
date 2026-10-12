# GrowthForge - Stage A Execution Plan (reviewable)

**Approved direction:** existing Lightsail + local PostgreSQL + Better Auth + Cloudflare R2,
preserving the existing Node API, frontend, AI, video, Stripe, and all completed
Business/Creator/Hybrid + Nigeria-localization work.

**Status:** planning only. Stages 1, 2, 3, 3B, 4 remain `PUSHED - NOT DEPLOYED`. Nothing is
resized, provisioned, migrated, or deployed until this plan is approved.

**Dependency audit results (verified from code):**

- **Auth (backend)** - `lib/supabaseClient.ts` (one admin client, service-role key),
  `lib/supabaseAuth.ts` (`supabase.auth.getUser`), and storage files that import the same
  client. Identity is **not** `auth.users`; it is our own `users` table (`id` = text UUID,
  with `email`, `role`, `isOwner`, `canAccessDev`, `plan`, `stripeCustomerId`, ...). All app
  tables FK to `users.id`. **Team invitations are already custom** (`team_members` table with
  `inviteToken`), not Supabase's invite API.
- **Auth (frontend)** - `contexts/auth-context.tsx`, `lib/supabaseClient.ts`,
  `lib/authFetch.ts`, `hooks/use-current-user.ts`, `pages/sign-in.tsx`, `sign-up.tsx`,
  `auth-redirect.tsx`, `team-accept.tsx`, `landing.tsx`, `dashboard.tsx`, `onboarding.tsx`,
  `plans.tsx`, `components/ui/user-menu.tsx`, `components/admin/admin-layout.tsx`.
- **Storage (backend, 12 files)** - `objectStorage.ts` (Supabase JS SDK: `.upload/.list/
  .createSignedUrl`), `objectAcl.ts`, `wanRenderer.ts`/`klingRenderer.ts`/`veoRenderer.ts`
  (S3-compatible paths), `ffmpegAssembler.ts`, `sceneManager.ts`, `videoRenderPipeline.ts`,
  `googleNarrator.ts`, `routes/storage.ts`, `routes/images.ts`, `routes/assemble.ts`.
- **Database** - 28 schema files; Drizzle migration dir has only the hand-written
  `0001_p0_creator_sources.sql` and **no `meta/` journal**, so a fresh DB is reconstructed by
  generating a clean full-schema migration, not by replaying `0001`.

---

## Part 1 - Required validations

### V1. Lightsail upgrade options & pricing (region `ca-central-1`)
Lightsail Linux bundle prices are global (not region-specific). Standard plans: **Nano $5**
(512 MB / 1 vCPU / 20 GB / 1 TB), **Micro $7** (1 GB / 40 GB / 2 TB), **Small $10** (2 GB /
1 vCPU / 60 GB / 3 TB), **Medium $20** (4 GB / 2 vCPU / 80 GB / 4 TB). Lightsail managed
PostgreSQL starts at **$15/mo** (1 GB / 40 GB). **Status: needs console confirmation at
resize time** (the $10/2 GB Small is the target; the current $5 Nano is the one that already
cannot run `vite build` on-box). A vertical resize is a console action with a brief reboot.

### V2. Current server resource measurement - **BLOCKED on owner access**
No SSH key or static IP is stored in this repo, so this sandbox cannot reach the Lightsail
box. This measurement is a **required first step** and must be run by the owner (or after
granting SSH). Exact commands to capture, in `docs/deployment.md` §11 style:

```bash
free -h; df -h /; nproc; cat /proc/meminfo | head -5
systemctl status growthforge-dev-api growthforge-prod-api --no-pager
ps aux --sort=-%mem | head -15
sudo journalctl -u growthforge-prod-api -n 200 --no-pager | tail -50
# while a video job runs:
top -b -n1 | head -20
```

**Decision gate:** if the box is currently near its 512 MB ceiling, the resize to Small is
mandatory (not optional) before Postgres is added.

### V3. Can PostgreSQL coexist on the box?
**Conclusion:** yes on **Small (2 GB)**, no on Nano. Recommended tuning (`postgresql.conf`):
`shared_buffers=256MB`, `work_mem=4MB`, `max_connections=60` (fronted by a pooler such as
`pgbouncer` if needed), `effective_cache_size=1GB`. Swap: keep the existing 2 GB swap file.
**Video-job isolation:** run ffmpeg under `nice -n 10` + `ionice -c3` and cap concurrent
assemblies (1 at a time on Small); render (GPU) is already off-box. Disk: 60 GB on Small is
ample at launch (media lives in R2, not the box); monitor `df` with a 80% alert.

### V4. PostgreSQL reconstruction from the Drizzle schema
Because the deleted Supabase DB is not recoverable and there is no Drizzle `meta/` journal,
reconstruct a **fresh** DB from the current schema (which already contains every Stage 1-4
column):
1. `pnpm --filter db generate` → emits a clean full-schema migration (all 28 tables).
2. `DATABASE_URL=... pnpm --filter db migrate` → applies it to the new empty DB.
3. Verify: `\dt` lists all 28 tables; `0001_p0_creator_sources.sql` remains only as a
   historical reference (its ALTERs are already reflected in the schema).

### V5. Better Auth replacement design
Use **better-auth** with its `user` model mapped to the existing `users` table (id = text
UUID), plus new `session`, `account`, `verification` tables. `additionalFields` carry
`role`, `isOwner`, `canAccessDev`, `plan`, `stripeCustomerId`, `subscriptionStatus`, etc.
- **Email/password** → better-auth email plugin.
- **Google OAuth** → better-auth social provider (existing `GOOGLE` client id/secret).
- **Password recovery** → better-auth email verification / reset link.
- **Sessions** → better-auth DB sessions + a JWT plugin for the API; `supabaseAuth.ts`
  becomes a `betterAuth.handler`/`getSession` verifier issuing the same `req.auth` shape.
- **Team invitations** → keep `team_members` + `inviteToken` unchanged; only the "create the
  user on accept" step changes from `supabase.auth.admin.createUser` to a better-auth
  sign-up. **Authorization is unchanged** (all `requireProjectOwnership` / role checks key
  off `req.auth.userId` → `users.id`).
- **User-ID compatibility:** `users.id` stays the canonical FK target; better-auth user ids
  are UUIDs stored as text, so existing `user_id` columns need **no migration**.

### V6. Cloudflare R2 migration design
Keep `objectStorage.ts`'s public API (upload/list/signed-url) and swap its internals from
the Supabase JS SDK to `@aws-sdk/client-s3` pointed at R2 (`https://<accountid>.r2.cloudflarestorage.com`,
access key id/secret). The renderers' S3 paths re-point with endpoint+keys only. **Buckets:**
a private `growthforge-media` (presigned GET for delivery, presigned PUT for renderer upload)
and a public bucket served via the Cloudflare public R2 domain. `objectAcl.ts` maps
public/private flags to the two buckets. Lifecycle: expire transient uploads after N days.

### V7. Encrypted off-server backups
Nightly `pg_dump --format=custom` → `age`-encrypt (age public key) → upload to a private R2
bucket. Retention: 30 daily + 12 monthly. **Restore drill (required, not optional):** decrypt
+ `pg_restore` into a scratch DB, then compare `\dt` + row counts against production.
Monitoring: a cron-failure alert (Betterstack or a health-check that reports last backup age).

### V8. Unrecoverable historical data policy
The deleted Supabase DB means historical users, projects, subscriptions, and media are
**gone unless an external backup exists** (none found in-repo). Policy: **start clean, do not
fabricate.** No `users`/`projects` rows are recreated. Stripe is treated separately: if
Stripe still holds customers with active subscriptions that have no matching `users` row,
the owner chooses to (a) treat them as lost and cancel/refund per policy, or (b) reconcile
by re-inviting them to re-onboard. Media in the deleted Storage is regenerated on demand.

### V9. Final cost + surprise-charge sources
See Part 3.

### V10. Incremental scaling path
Postgres is reached via `DATABASE_URL` only → moving it to a dedicated box or Lightsail
managed PG is an env-var change. The API is stateless (sessions in DB, media in R2) → it
scales horizontally behind a load balancer with no rewrite. Video/content jobs will be
routed through a queue (BullMQ/Redis) so they can later move to a separate worker node.

---

## Part 2 - Implementation phases

### Phase 0 - Infrastructure prep + measurement
- **Files:** none (console + shell). **Deps:** owner access to Lightsail console/SSH.
- **Actions:** run V2 measurement; resize Nano→Small $10; confirm region/bundle; snapshot
  current disk; install `postgresql-16` + `pgbouncer`; create a dedicated `postgres` user/db.
- **Risks:** resize downtime (~1 reboot); wrong bundle. **Tests:** `free -h`, `df`, Postgres
  `SELECT version()`. **Rollback:** Lightsail can resize back; pre-resize snapshot.
- **Approval required:** owner (this is the first infra change).

### Phase 1 - Database reconstruction
- **Files:** new generated migration in `lib/db/migrations/`; `lib/db/drizzle.config.ts`
  (point at local `DATABASE_URL`).
- **Deps:** Phase 0. **Actions:** V4 steps; verify 28 tables; run the existing
  `businessSourceIngestor` + localization unit tests against the new DB where DB-free.
- **Risks:** schema drift if `generate` is run against an inconsistent meta. **Tests:** `\dt`
  count; a smoke `SELECT` across key tables; typecheck. **Rollback:** drop the DB and
  re-migrate (empty DB, no data loss). **Approval:** owner (schema creation on prod box).

### Phase 2 - Better Auth integration
- **Files:** `lib/supabaseClient.ts` (retire), `lib/supabaseAuth.ts` (→ better-auth), new
  `lib/auth.ts` + `lib/authSchema.ts`; `auth-context.tsx`, `lib/supabaseClient.ts`,
  `lib/authFetch.ts`, `use-current-user.ts`, `sign-in.tsx`, `sign-up.tsx`,
  `auth-redirect.tsx`, `team-accept.tsx`, `user-menu.tsx`, `admin-layout.tsx`.
- **Deps:** Phase 1 (user tables). **Actions:** map `users` + add session/account/
  verification tables; swap backend middleware; swap frontend sign-in/OAuth/session.
- **Risks:** session-token format change breaks `authFetch`; OAuth redirect URI mismatch.
  **Tests:** sign-up/sign-in/OAuth/reset/team-accept; `req.auth.userId` still resolves to
  `users.id`; all ownership middleware passes. **Rollback:** keep Supabase behind a flag
  until cutover (dual-auth shim) or revert commit. **Approval:** owner (auth swap).

### Phase 3 - Object-storage integration (Wasabi, S3-compatible)
- **Files:** `objectStorage.ts` (internal swap), `objectAcl.ts`, renderers'
  S3 endpoints, `.env` (R2 keys), `routes/storage.ts`/`images.ts`/`assemble.ts` (only if they
  reference Supabase storage directly).
- **Deps:** Wasabi bucket + least-privilege access key (owner approves/creates). **Actions:** create buckets,
  rewrite upload/list/presign, re-point renderers, add lifecycle rules.
- **Risks:** presigned-URL expiry/signature; public-vs-private ACL regression.
  **Tests:** upload/list/signed-GET/signed-PUT; a render job writes to R2 and is readable;
  ACL tests. **Rollback:** env-var switch back to Supabase (if still alive) or revert.
  **Approval:** owner (create R2 resources + tokens).

### Phase 4 - Application compatibility + config
- **Files:** `.env`/`.env.example` (drop `SUPABASE_*` for DB/auth/storage, add
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `R2_*`); `supabaseClient.ts` removal fallout;
  `vite.config.ts`/env docs; `scripts/post-merge.sh` (replace `db push` with `db migrate`
  or remove the hook entirely - it is dangerous and only runs on legacy Replit).
- **Deps:** Phases 2-3. **Tests:** typecheck + build (backend + frontend).
  **Rollback:** revert. **Approval:** owner.

### Phase 5 - Integration + regression testing
- **Tests:** full backend typecheck/build/tests (expect the 3 DB-blocked files to now load);
  frontend typecheck/build; onboarding business/creator/hybrid; website-less; source
  management; Nigeria localization (4/4); analysis/persona/strategy; content/ads; team
  invite; billing gating. **Approval:** owner to promote to staging if a staging slot exists.

### Phase 6 - Backup + restore verification
- **Actions:** V7 setup; run the restore drill; record result in the register.
  **Approval:** owner (confirm backup is verified before it counts as a gate).

### Phase 7 - Deployment prep + production cutover
- **Actions:** follow `PRODUCTION_DEPLOYMENT_RUNBOOK.md` §8-11 (build locally, scp dist,
  systemd restart, health check, Caddy route swap from Coming Soon → app). **No GitHub
  auto-deploy exists**, so cutover is explicit. **Approval:** owner (deploy).

### Phase 8 - Live smoke tests
- **Actions:** run the 16-item smoke plan (runbook §13), including Nigeria locale/currency.
  **Approval:** owner (flip stages to `PRODUCTION VERIFIED` only after passing).

### Phase 9 - Register update
- **Files:** `docs/DEPLOYMENT_REGISTER.md`. Mark Stage 5 + the five prior stages
  `PRODUCTION VERIFIED` only as each smoke test passes.

---

## Part 3 - Final cost assessment

### Fixed (monthly)
| Item | Cost |
|---|---|
| Lightsail Small (2 GB) | $10.00 |
| Domain (annualized) | ~$1.00 |
| Cloudflare R2 (media + backups, ~20-50 GB, low ops) | ~$0.50-1.00 |
| Monitoring | $0 |
| **Fixed subtotal** | **~$11.50-12/mo** |

### Variable (usage-driven, capped - not fixed)
| Item | Assumption | Estimate |
|---|---|---|
| Google Gemini | ~$0.05-0.20/analysis, ~$0.01-0.05/content | $20-60/mo at light use |
| Wan 2.2 GPU (Vast/RunPod) | ~$0.02-0.05/sec of video | $30-100/mo at ~50 videos |

### Surprise-charge sources to guard (all controllable)
Lightsail transfer overage (Small = 3 TB - unlikely) · R2 Class A/B operations (tiny,
$0.36-4.50 per million) · Gemini overage (Google budget alert + app spend cap) ·
Vast.ai/RunPod (spend limits + auto-stop) · Stripe fees · domain renewal. The §6 controls
from `INFRASTRUCTURE_ARCHITECTURE.md` (per-plan caps, global kill-switch, lifecycle,
per-customer metering) are the enforcement layer.

---

## Part 4 - Preserved work (unchanged)
Stages 1-4 (schema, backend, frontend onboarding, sources, Nigeria localization) stay as-is
and remain `PUSHED - NOT DEPLOYED` until the live smoke tests pass. The only code that
changes is the Supabase coupling layer (auth + storage + config), not feature logic.
