export type BillingInterval = "monthly" | "annual";

export interface NigeriaPlan {
  slug: string;
  name: string;
  envKey: string; // normalized key for PAYSTACK_PLAN_<KEY>_<INTERVAL> env vars
  monthlyNgn: number;
  annualNgn: number;
}

/** Annual subscriptions bill 12 months at a 15% discount, upfront. */
export const ANNUAL_DISCOUNT_PCT = 15;

export function annualUpfront(monthlyNgn: number): number {
  return Math.round((monthlyNgn * 12 * (100 - ANNUAL_DISCOUNT_PCT)) / 100);
}

const PLAN_CONFIG: Array<Pick<NigeriaPlan, "slug" | "name" | "envKey" | "monthlyNgn">> = [
  { slug: "starter",  name: "Starter",   envKey: "starter",  monthlyNgn: 40_000 },
  { slug: "get-going", name: "Get-Going", envKey: "getgoing", monthlyNgn: 100_000 },
  { slug: "growth",   name: "Growth",    envKey: "growth",   monthlyNgn: 250_000 },
  { slug: "agency",   name: "Agency",    envKey: "agency",   monthlyNgn: 600_000 },
];

export const NIGERIA_PLANS: NigeriaPlan[] = PLAN_CONFIG.map((p) => ({
  ...p,
  annualNgn: annualUpfront(p.monthlyNgn),
}));

export function getNigeriaPlan(slug: string): NigeriaPlan | null {
  return NIGERIA_PLANS.find((p) => p.slug === slug) ?? null;
}

/**
 * Paystack plan codes MUST be real Paystack-generated plan codes (created via
 * `POST /plan` or the dashboard). They are supplied via environment variables -
 * we do NOT assume arbitrary `gf_*` identifiers are valid:
 *
 *   PAYSTACK_PLAN_STARTER_MONTHLY   PAYSTACK_PLAN_STARTER_ANNUAL
 *   PAYSTACK_PLAN_GETGOING_MONTHLY  PAYSTACK_PLAN_GETGOING_ANNUAL
 *   PAYSTACK_PLAN_GROWTH_MONTHLY    PAYSTACK_PLAN_GROWTH_ANNUAL
 *   PAYSTACK_PLAN_AGENCY_MONTHLY    PAYSTACK_PLAN_AGENCY_ANNUAL
 *
 * Returns null (fail-closed) when a code is not configured.
 */
function envPlanCode(envKey: string, interval: BillingInterval): string | null {
  const key = `PAYSTACK_PLAN_${envKey.toUpperCase()}_${interval.toUpperCase()}`;
  const value = process.env[key];
  return value && value.trim() ? value.trim() : null;
}

export function getPlanCode(slug: string, interval: BillingInterval): string | null {
  const plan = getNigeriaPlan(slug);
  if (!plan) return null;
  return envPlanCode(plan.envKey, interval);
}

export function getPlanAmountNgn(slug: string, interval: BillingInterval): number | null {
  const plan = getNigeriaPlan(slug);
  if (!plan) return null;
  return interval === "monthly" ? plan.monthlyNgn : plan.annualNgn;
}

export function findNigeriaPlanByCode(code: string): { plan: NigeriaPlan; interval: BillingInterval } | null {
  for (const plan of NIGERIA_PLANS) {
    if (envPlanCode(plan.envKey, "monthly") === code) return { plan, interval: "monthly" };
    if (envPlanCode(plan.envKey, "annual") === code) return { plan, interval: "annual" };
  }
  return null;
}

export function isValidNigeriaCurrency(currency: string | undefined | null): boolean {
  return (currency ?? "").toUpperCase() === "NGN";
}
