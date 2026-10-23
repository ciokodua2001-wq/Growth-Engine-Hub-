import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Paystack TEST-mode E2E for the app's own checkout + signature code paths.
 * Reads the secret/plan codes from the git-ignored toolbox file (never from
 * this file, never committed). Skips cleanly when the toolbox isn't present so
 * the normal suite still runs.
 */

function loadToolboxEnv(): Record<string, string> {
  const p = path.resolve(process.cwd(), "../../.env.prod.wasabi");
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const toolbox = loadToolboxEnv();
process.env.PAYSTACK_TEST_SECRET_KEY = toolbox.PAYSTACK_TEST_SECRET_KEY ?? "";
for (const [k, v] of Object.entries(toolbox)) {
  if (k.startsWith("PAYSTACK_PLAN_")) process.env[k] = v;
}

let getPlanCode: any;
let getPlanAmountNgn: any;
let initializeSubscription: any;
let verifyWebhookSignature: any;

beforeAll(async () => {
  ({ getPlanCode, getPlanAmountNgn } = await import("../nigeriaPricing.js"));
  ({ initializeSubscription, verifyWebhookSignature } = await import("../paystackClient.js"));
});

const SKIP = !process.env.PAYSTACK_TEST_SECRET_KEY || process.env.PAYSTACK_TEST_SECRET_KEY === "";

describe.skipIf(SKIP)("Paystack TEST checkout E2E (app code)", () => {
  it("maps all 8 plan codes + correct NGN amounts from env", () => {
    const cases: Array<[string, "monthly" | "annual", number]> = [
      ["starter", "monthly", 40_000], ["starter", "annual", 408_000],
      ["get-going", "monthly", 100_000], ["get-going", "annual", 1_020_000],
      ["growth", "monthly", 250_000], ["growth", "annual", 2_550_000],
      ["agency", "monthly", 600_000], ["agency", "annual", 6_120_000],
    ];
    for (const [slug, interval, ngn] of cases) {
      const code = getPlanCode(slug, interval);
      expect(code, `${slug}/${interval} code`).toMatch(/^PLN_/);
      expect(getPlanAmountNgn(slug, interval)).toBe(ngn);
    }
  });

  it("initializes monthly + annual checkout and returns an authorization_url", async () => {
    for (const interval of ["monthly", "annual"] as const) {
      const res = await initializeSubscription({
        email: "e2e@example.com",
        planCode: getPlanCode("starter", interval),
        callbackUrl: "https://ng.usegrowthforge.com/plans?paystack=success",
        metadata: { userId: "e2e-user", plan: "starter", interval },
      });
      expect(res.authorization_url).toMatch(/^https:\/\//);
      expect(res.reference).toBeTruthy();
      expect(res.access_code).toBeTruthy();
    }
  });

  it("verifies a real HMAC-SHA512 signature with the test secret key", () => {
    const secret = process.env.PAYSTACK_TEST_SECRET_KEY!;
    const body = Buffer.from(JSON.stringify({ event: "charge.success" }));
    const sig = crypto.createHmac("sha512", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    expect(verifyWebhookSignature(body, "deadbeef")).toBe(false);
  });
});
