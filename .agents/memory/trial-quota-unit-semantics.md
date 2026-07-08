---
name: Trial quota unit semantics (call-based vs count-based)
description: How to decide whether a trial/plan limit should consume 1 unit per API call or 1 unit per generated artifact, using GrowthForge's pricing-card wording as the deciding signal.
---

When enforcing a "N <thing>" trial limit against an endpoint that can produce a variable-size batch in one call, don't default to count-based (1 unit per generated item) or call-based (1 unit per request) without checking which one the advertised copy actually implies — the two give very different UX.

**Why:** GrowthForge's trial card said "1 Video Blueprint" but the video endpoint's default "auto" mode generates 9 videos in a single call. Enforcing count-based (limit=1 unit per video) would make the flagship auto-generate demo un-usable on the very first call, since 9 > 1 fails atomically. Enforcing call-based (limit=1 unit per POST call, regardless of batch size) matches the singular "1 Video Blueprint" / "1 Email Campaign" wording and lets the batch through as a single trial "session."

**How to apply:** Use plural/countable copy ("5 Social Posts", "25 Forge AI Messages") as the signal for count-based consumption (pass the actual generated/consumed count as the `amount` into the quota function). Use singular/session-like copy ("1 Video Blueprint", "1 Email Campaign", "1 Marketing Strategy") as the signal for call-based consumption (always consume exactly 1 unit per request, independent of internal batch size). When genuinely ambiguous, prefer call-based for any endpoint whose default behavior produces a multi-item batch, since count-based would otherwise block the primary/demo path on the first use.
