export type BillingInterval = "monthly" | "annual";

export interface NigeriaPlan {
  slug: string;
  name: string;
  monthlyNgn: number; // ₦ billed monthly
  annualNgn: number;  // ₦ billed annually upfront (15% off)
  planCodeMonthly: string;
  planCodeAnnual: string;
}

/** Annual subscriptions bill 12 months at a 15% discount, upfront. */
export const ANNUAL_DISCOUNT_PCT = 15;

export function annualUpfront(monthlyNgn: number): number {
  return Math.round((monthlyNgn * 12 * (100 - ANNUAL_DISCOUNT_PCT)) / 100);
}

const PLAN_CONFIG: Array<Pick<NigeriaPlan, "slug" | "name" | "monthlyNgn" | "planCodeMonthly" | "planCodeAnnual">> = [
  { slug: "starter",  name: "Starter",   monthlyNgn: 40_000,  planCodeMonthly: "gf_starter_monthly",  planCodeAnnual: "gf_starter_annual" },
  { slug: "get-going", name: "Get-Going", monthlyNgn: 100_000, planCodeMonthly: "gf_getgoing_monthly", planCodeAnnual: "gf_getgoing_annual" },
  { slug: "growth",   name: "Growth",    monthlyNgn: 250_000, planCodeMonthly: "gf_growth_monthly",  planCodeAnnual: "gf_growth_annual" },
  { slug: "agency",   name: "Agency",    monthlyNgn: 600_000, planCodeMonthly: "gf_agency_monthly", planCodeAnnual: "gf_agency_annual" },
];

export const NIGERIA_PLANS: NigeriaPlan[] = PLAN_CONFIG.map((p) => ({
  ...p,
  annualNgn: annualUpfront(p.monthlyNgn),
}));

export function getNigeriaPlan(slug: string): NigeriaPlan | null {
  return NIGERIA_PLANS.find((p) => p.slug === slug) ?? null;
}

export function getPlanCode(slug: string, interval: BillingInterval): string | null {
  const plan = getNigeriaPlan(slug);
  if (!plan) return null;
  return interval === "monthly" ? plan.planCodeMonthly : plan.planCodeAnnual;
}

export function getPlanAmountNgn(slug: string, interval: BillingInterval): number | null {
  const plan = getNigeriaPlan(slug);
  if (!plan) return null;
  return interval === "monthly" ? plan.monthlyNgn : plan.annualNgn;
}

export function isValidNigeriaCurrency(currency: string | undefined | null): boolean {
  return (currency ?? "").toUpperCase() === "NGN";
}

export function findNigeriaPlanByCode(code: string): { plan: NigeriaPlan; interval: BillingInterval } | null {
  for (const plan of NIGERIA_PLANS) {
    if (plan.planCodeMonthly === code) return { plan, interval: "monthly" };
    if (plan.planCodeAnnual === code) return { plan, interval: "annual" };
  }
  return null;
}
