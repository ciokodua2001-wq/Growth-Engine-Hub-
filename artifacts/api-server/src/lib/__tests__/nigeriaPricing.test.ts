import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
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
import { verifyWebhookSignature } from "../paystackClient.js";

const PLAN_ENV: Record<string, string> = {
  PAYSTACK_PLAN_STARTER_MONTHLY: "pln_starter_monthly",
  PAYSTACK_PLAN_STARTER_ANNUAL: "pln_starter_annual",
  PAYSTACK_PLAN_GETGOING_MONTHLY: "pln_getgoing_monthly",
  PAYSTACK_PLAN_GETGOING_ANNUAL: "pln_getgoing_annual",
  PAYSTACK_PLAN_GROWTH_MONTHLY: "pln_growth_monthly",
  PAYSTACK_PLAN_GROWTH_ANNUAL: "pln_growth_annual",
  PAYSTACK_PLAN_AGENCY_MONTHLY: "pln_agency_monthly",
  PAYSTACK_PLAN_AGENCY_ANNUAL: "pln_agency_annual",
};

beforeEach(() => Object.assign(process.env, PLAN_ENV));
afterEach(() => { for (const k of Object.keys(PLAN_ENV)) delete process.env[k]; });

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
    expect(Object.fromEntries(NIGERIA_PLANS.map((p) => [p.slug, p.annualNgn]))).toEqual({
      starter: 408_000,
      "get-going": 1_020_000,
      growth: 2_550_000,
      agency: 6_120_000,
    });
  });

  it("resolves Paystack plan codes from env (fail-closed when unset)", () => {
    expect(getPlanCode("starter", "monthly")).toBe("pln_starter_monthly");
    expect(getPlanCode("agency", "annual")).toBe("pln_agency_annual");
    // fail-closed: arbitrary gf_* identifiers are NOT assumed valid
    expect(findNigeriaPlanByCode("gf_starter_monthly")).toBeNull();
    delete process.env.PAYSTACK_PLAN_STARTER_MONTHLY;
    expect(getPlanCode("starter", "monthly")).toBeNull();
  });

  it("reverse-maps env plan codes to slug + interval", () => {
    expect(findNigeriaPlanByCode("pln_starter_monthly")).toEqual({
      plan: expect.objectContaining({ slug: "starter" }),
      interval: "monthly",
    });
    expect(findNigeriaPlanByCode("pln_agency_annual")).toEqual({
      plan: expect.objectContaining({ slug: "agency" }),
      interval: "annual",
    });
    expect(findNigeriaPlanByCode("pln_unknown")).toBeNull();
  });

  it("looks up amounts and validates NGN currency", () => {
    expect(getNigeriaPlan("growth")?.monthlyNgn).toBe(250_000);
    expect(getPlanAmountNgn("agency", "annual")).toBe(6_120_000);
    expect(getPlanAmountNgn("agency", "monthly")).toBe(600_000);
    expect(isValidNigeriaCurrency("NGN")).toBe(true);
    expect(isValidNigeriaCurrency("ngn")).toBe(true);
    expect(isValidNigeriaCurrency("USD")).toBe(false);
    expect(isValidNigeriaCurrency(undefined)).toBe(false);
  });
});

describe("region resolution (exact hostname only)", () => {
  it("maps only the explicitly approved Nigeria hosts to Nigeria", () => {
    expect(resolveRegion("ng.usegrowthforge.com")).toBe("nigeria");
    expect(resolveRegion("ng.dev.usegrowthforge.com")).toBe("nigeria");
    expect(resolveRegion("NG.usegrowthforge.com:443")).toBe("nigeria");

    // Case normalization and explicit ports are supported for both exact hosts.
    expect(resolveRegion("NG.DEV.USEGROWTHFORGE.COM")).toBe("nigeria");
    expect(resolveRegion("NG.DEV.USEGROWTHFORGE.COM:8443")).toBe("nigeria");

    // Forged, broad, and near-match hosts must NOT map to Nigeria.
    expect(resolveRegion("ng.anything.example")).toBe("global");
    expect(resolveRegion("ng.evil.com")).toBe("global");
    expect(resolveRegion("ng.usegrowthforge.com.evil.com")).toBe("global");
    expect(resolveRegion("ng.dev.usegrowthforge.com.evil.com")).toBe("global");
    expect(resolveRegion("xng.dev.usegrowthforge.com")).toBe("global");
  });

  it("preserves Global mappings and defaults to Global", () => {
    expect(resolveRegion("usegrowthforge.com")).toBe("global");
    expect(resolveRegion("dev.usegrowthforge.com")).toBe("global");
    expect(resolveRegion("DEV.USEGROWTHFORGE.COM:443")).toBe("global");
    expect(resolveRegion(undefined)).toBe("global");
    expect(resolveRegion(null)).toBe("global");
  });
});

describe("Paystack webhook signature", () => {
  it("accepts a correct HMAC-SHA512 and rejects wrong/missing signatures", () => {
    const secret = "sk_test_signature_secret";
    process.env.PAYSTACK_SECRET_KEY = secret;
    const body = Buffer.from(JSON.stringify({ event: "charge.success" }));
    const sig = crypto.createHmac("sha512", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    expect(verifyWebhookSignature(body, "deadbeef")).toBe(false);
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
    delete process.env.PAYSTACK_SECRET_KEY;
  });
});
