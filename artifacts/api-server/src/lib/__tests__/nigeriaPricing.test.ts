import { describe, it, expect } from "vitest";
import {
  NIGERIA_PLANS,
  ANNUAL_DISCOUNT_PCT,
  annualUpfront,
  getNigeriaPlan,
  getPlanCode,
  getPlanAmountNgn,
  findNigeriaPlanByCode,
  isValidNigeriaCurrency,
} from "../nigeriaPricing.js";
import { resolveRegion } from "../region.js";

describe("Nigeria NGN pricing", () => {
  it("defines all four plans with the approved monthly prices", () => {
    expect(NIGERIA_PLANS.map((p) => p.slug)).toEqual(["starter", "get-going", "growth", "agency"]);
    expect(Object.fromEntries(NIGERIA_PLANS.map((p) => [p.slug, p.monthlyNgn]))).toEqual({
      starter: 40_000,
      "get-going": 100_000,
      growth: 250_000,
      agency: 600_000,
    });
  });

  it("computes annual upfront at exactly 15% off (monthly × 12 × 0.85)", () => {
    expect(ANNUAL_DISCOUNT_PCT).toBe(15);
    expect(annualUpfront(40_000)).toBe(408_000);
    expect(annualUpfront(100_000)).toBe(1_020_000);
    expect(annualUpfront(250_000)).toBe(2_550_000);
    expect(annualUpfront(600_000)).toBe(6_120_000);
    // The full approved annual table
    expect(Object.fromEntries(NIGERIA_PLANS.map((p) => [p.slug, p.annualNgn]))).toEqual({
      starter: 408_000,
      "get-going": 1_020_000,
      growth: 2_550_000,
      agency: 6_120_000,
    });
  });

  it("reverse-maps Paystack plan codes to slug + interval", () => {
    expect(findNigeriaPlanByCode("gf_starter_monthly")).toEqual({
      plan: expect.objectContaining({ slug: "starter" }),
      interval: "monthly",
    });
    expect(findNigeriaPlanByCode("gf_agency_annual")).toEqual({
      plan: expect.objectContaining({ slug: "agency" }),
      interval: "annual",
    });
    expect(findNigeriaPlanByCode("gf_unknown")).toBeNull();
  });

  it("looks up plan codes + amounts and validates NGN currency", () => {
    expect(getNigeriaPlan("growth")?.monthlyNgn).toBe(250_000);
    expect(getPlanCode("starter", "annual")).toBe("gf_starter_annual");
    expect(getPlanCode("get-going", "monthly")).toBe("gf_getgoing_monthly");
    expect(getPlanAmountNgn("agency", "annual")).toBe(6_120_000);
    expect(getPlanAmountNgn("agency", "monthly")).toBe(600_000);
    expect(isValidNigeriaCurrency("NGN")).toBe(true);
    expect(isValidNigeriaCurrency("ngn")).toBe(true);
    expect(isValidNigeriaCurrency("USD")).toBe(false);
    expect(isValidNigeriaCurrency(undefined)).toBe(false);
  });
});

describe("region resolution (hostname-scoped storefront)", () => {
  it("resolves ng.* hosts to Nigeria", () => {
    expect(resolveRegion("ng.usegrowthforge.com")).toBe("nigeria");
    expect(resolveRegion("NG.usegrowthforge.com:443")).toBe("nigeria");
    expect(resolveRegion("ng.any.example")).toBe("nigeria");
  });

  it("resolves apex and non-ng subdomains to global", () => {
    expect(resolveRegion("usegrowthforge.com")).toBe("global");
    expect(resolveRegion("dev.usegrowthforge.com")).toBe("global");
    expect(resolveRegion("www.usegrowthforge.com")).toBe("global");
    expect(resolveRegion(undefined)).toBe("global");
  });
});
