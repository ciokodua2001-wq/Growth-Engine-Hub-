/**
 * Internal cost-weight definitions for refund eligibility calculations.
 *
 * SECURITY: These values are NEVER included in any API response or frontend bundle.
 * They are used server-side only for admin refund eligibility assessments.
 */

/** Estimated USD cost per unit of each AI feature */
export const ACTION_COST_USD: Record<string, number> = {
  analysis:          0.030,
  competitors:       0.020,
  competitor_report: 0.040,
  personas:          0.020,
  strategy:          0.020,
  social_posts:      0.005,   // per post
  email_campaigns:   0.020,
  video_blueprints:  0.030,   // per batch call (clamped)
  ads:               0.005,   // per ad
  agent_messages:    0.012,
  video_render_1080p: 0.015,  // per minute rendered
  video_render_4k:    0.033,  // per minute rendered (≈2.2× cost)
};

/**
 * Monthly AI cost ceiling per plan at full utilization (internal).
 * Threshold = 15% of this value.
 */
export const PLAN_MONTHLY_AI_CEILING: Record<string, number> = {
  trial:       0.45,
  starter:     1.65,
  "get-going": 5.10,
  growth:      11.00,
  agency:      22.00,
};

/** Internal refund ineligibility threshold (fraction of monthly ceiling) */
export const REFUND_INELIGIBILITY_THRESHOLD = 0.15;

/** Refund window in milliseconds (3 days from subscription start) */
export const REFUND_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type RefundEligibility = "eligible" | "borderline" | "non_refundable";

export interface RefundStatus {
  eligibility: RefundEligibility;
  reason: "within_window" | "approaching_threshold" | "threshold_exceeded" | "video_rendered" | "window_expired";
  consumedUsd: number;
  ceilingUsd: number;
  consumedPct: number;
  thresholdPct: number;
  hasVideoRender: boolean;
  withinWindow: boolean;
}

/**
 * Compute refund eligibility for a subscriber.
 *
 * @param consumedUsd  - total AI cost accumulated this billing period
 * @param planName     - plan name key (e.g. "starter", "growth")
 * @param hasVideoRender - whether any video render was initiated this period
 * @param subscriptionStartMs - epoch ms of subscription start (or billing period start)
 */
export function computeRefundStatus(
  consumedUsd: number,
  planName: string,
  hasVideoRender: boolean,
  subscriptionStartMs: number,
): RefundStatus {
  const ceiling = PLAN_MONTHLY_AI_CEILING[planName.toLowerCase()] ?? PLAN_MONTHLY_AI_CEILING["starter"];
  const consumedPct = ceiling > 0 ? consumedUsd / ceiling : 0;
  const withinWindow = Date.now() - subscriptionStartMs <= REFUND_WINDOW_MS;

  if (hasVideoRender) {
    return { eligibility: "non_refundable", reason: "video_rendered", consumedUsd, ceilingUsd: ceiling, consumedPct, thresholdPct: REFUND_INELIGIBILITY_THRESHOLD, hasVideoRender, withinWindow };
  }
  if (!withinWindow) {
    return { eligibility: "non_refundable", reason: "window_expired", consumedUsd, ceilingUsd: ceiling, consumedPct, thresholdPct: REFUND_INELIGIBILITY_THRESHOLD, hasVideoRender, withinWindow };
  }
  if (consumedPct >= REFUND_INELIGIBILITY_THRESHOLD) {
    return { eligibility: "non_refundable", reason: "threshold_exceeded", consumedUsd, ceilingUsd: ceiling, consumedPct, thresholdPct: REFUND_INELIGIBILITY_THRESHOLD, hasVideoRender, withinWindow };
  }
  if (consumedPct >= REFUND_INELIGIBILITY_THRESHOLD * 0.67) {
    return { eligibility: "borderline", reason: "approaching_threshold", consumedUsd, ceilingUsd: ceiling, consumedPct, thresholdPct: REFUND_INELIGIBILITY_THRESHOLD, hasVideoRender, withinWindow };
  }
  return { eligibility: "eligible", reason: "within_window", consumedUsd, ceilingUsd: ceiling, consumedPct, thresholdPct: REFUND_INELIGIBILITY_THRESHOLD, hasVideoRender, withinWindow };
}

/** Cost weight for a feature action (returns 0 for unknown features) */
export function costForFeature(feature: string, amount = 1): number {
  return (ACTION_COST_USD[feature] ?? 0) * amount;
}
