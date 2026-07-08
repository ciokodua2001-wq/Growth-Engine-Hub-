---
name: Agent chat intent classification pattern
description: Two-call design for an AI chat agent that can both converse and trigger metered content-generation actions
---

When an AI chat endpoint can both have a normal conversation AND trigger side-effecting
content generation (e.g. "write me some social posts"), split it into two AI calls:

1. **Classification call** — cheap, single call. Given the user message + conversation
   history + grounding context, returns `{ intent, responseMessage, ...actionParams }`.
   `responseMessage` is pre-written as if the action already succeeded (e.g. "Done! I've
   written 6 LinkedIn posts...") so the reply reads naturally without a second round-trip
   for phrasing.
2. **Action call** — only runs if intent isn't plain chat, via the same shared generator
   functions the direct REST endpoints use (so agent-triggered content matches
   endpoint-triggered content exactly).

**Why:** Keeps the flat per-message quota (e.g. "25 agent messages") from being a
bypass for per-feature quotas (e.g. "5 social posts"). Classify first, then charge the
*specific* feature's quota before paying for the real generation call — never generate
before both quotas are confirmed. If a feature has no dedicated trial quota (e.g. "ads"
wasn't on the pricing card), explicitly skip that sub-quota check rather than mapping it
to an unrelated feature's quota.

**How to apply:** Any chat/agent surface that can both talk and act, especially where
the "act" side is metered per-feature separately from a flat message cap.
