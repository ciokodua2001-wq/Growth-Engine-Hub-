---
name: Stripe schema bootstrap
description: stripe-replit-sync's runMigrations() may only create the schema on first run, not the tables — requires a second call or manual run.
---

On first server startup, `runMigrations({ databaseUrl })` from `stripe-replit-sync` may create the `stripe` schema but leave it empty (no tables). Subsequent calls or a manual run (`pnpm --filter @workspace/api-server exec node --input-type=module -e "import { runMigrations } from 'stripe-replit-sync'; await runMigrations({ databaseUrl: process.env.DATABASE_URL });"`) completes the migration and creates all 29 tables.

**Why:** Race condition or partial migration on first call in the same process. Second call always succeeds.

**How to apply:** If the API server logs `relation "stripe.accounts" does not exist`, run the migration script manually once. After that, server restarts will find the schema already complete.
