---
name: Stripe products endpoint — fetch live not synced DB
description: Why GET /stripe/products must call Stripe API directly rather than querying the stripe.* schema tables.
---

The `stripe-replit-sync` package syncs Stripe data into local `stripe.*` schema tables. However this sync:
- Reflects whichever account was connected at time of sync
- Does not immediately update when the API key changes
- Can lag by a full restart cycle

**Why:** When we switched from a restricted key to a real secret key, the `stripe.products` table still had 3 old products from the restricted account. The 4 new correctly-priced products existed only in Stripe, not in the local DB yet.

**Rule:** `GET /stripe/products` (and any route where freshness matters for the purchase flow) should call `stripe.products.list()` + `stripe.prices.list()` directly. The synced DB is fine for subscription/customer lookups which are less time-sensitive.

**How to apply:** In `routes/stripe.ts`, the products route calls `getUncachableStripeClient()` and fetches live. Only include products that have `metadata.plan` set (to filter out non-GrowthForge products in the Stripe account).
