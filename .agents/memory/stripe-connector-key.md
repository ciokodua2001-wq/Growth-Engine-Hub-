---
name: Stripe connector settings key
description: The Replit Stripe integration exposes the secret key under a different field name than the skill template shows.
---

The Replit connectors API for the Stripe integration returns the secret key as `settings.secret`, not `settings.secret_key`.

**Why:** The skill code-templates.md shows `settings.secret_key` but the actual Replit Stripe connector stores it as `settings.secret`. Discovered by inspecting the live connector response via bash.

**How to apply:** In both `artifacts/api-server/src/stripeClient.ts` and `scripts/src/stripeClient.ts`, use `settings.secret` (not `settings.secret_key`) when reading the Stripe secret key from the connectors API response.

Other settings keys returned: `account_id`, `secret`, `publishable`, `mcp`, `claim_url`. No `webhook_secret` in settings — webhook secret comes from `stripe-replit-sync` managed webhooks.
