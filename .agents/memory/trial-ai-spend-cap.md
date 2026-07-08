---
name: Trial AI spend cap methodology
description: How to size TRIAL_LIMITS quotas so total AI cost per trial stays under a target budget
---

When a user sets a hard $ budget for AI cost per trial/user (e.g. "never more than $0.45 per trial"), there is no real usage-based cost tracking available — you must budget from conservative per-unit token estimates, not exact metering.

**Method:**
1. For each AI-costing feature, estimate worst-case input/output tokens (grounding-context block size + prompt + max plausible output for that generator), then cost it at the model's per-token price (e.g. Claude Sonnet ~$3/M input, $15/M output).
2. Round each per-unit estimate up generously (real usage is usually lower than worst-case verbosity).
3. Multiply each feature's per-unit cost by its proposed quota limit, sum across all features, and leave ~15-20% headroom under the target budget (estimates aren't exact metering).
4. For call-based features whose batch size can vary a lot (e.g. "generate N videos in one call"), don't just budget for the quota count — also clamp the max batch size per call on the trial plan, otherwise one call can blow the per-unit estimate.
5. If a feature is reachable both via a direct endpoint and via an agent/chat "action" intent, make sure both paths consume the *same* underlying quota — otherwise the chat path is an uncapped bypass.
6. Every AI-costing feature must have a quota entry, even ones not on the pricing card or not yet wired to real AI — cap them anyway so they're safe by default if wired up later.

**Why:** without a per-feature budget derived this way, it's easy to add one popular feature (e.g. chat/agent messages, which pay a classification-call cost on every single message regardless of whether an action fires) that alone consumes most of the budget while looking "cheap" per-unit.

**How to apply:** re-run this sizing exercise whenever a new AI-costing feature is added or an existing quota is raised — see the worked example and current numbers in `replit.md` under GrowthForge AI's "Trial AI spend cap" bullet.
