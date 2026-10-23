import crypto from "node:crypto";

/**
 * Paystack REST client (test-mode by default; live only when the operator
 * intentionally points PAYSTACK_BASE_URL / PAYSTACK_SECRET_KEY at live keys).
 * Uses the Paystack secret key (sk_test_... in test) - never exposed in logs.
 */
const BASE_URL = process.env.PAYSTACK_BASE_URL ?? "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return key;
}

export interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface InitializeTransactionData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

async function paystackRequest<T>(method: string, path: string, body?: unknown): Promise<PaystackResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as PaystackResponse<T>;
  if (!json.status) throw new Error(`Paystack ${method} ${path} failed: ${json.message}`);
  return json;
}

/**
 * Start a subscription checkout by subscribing `email` to an existing Paystack
 * plan (the plan carries the amount + interval, so no amount is sent here).
 */
export async function initializeSubscription(opts: {
  email: string;
  planCode: string;
  callbackUrl: string;
  metadata?: Record<string, string>;
}): Promise<InitializeTransactionData> {
  const resp = await paystackRequest<InitializeTransactionData>("POST", "/transaction/initialize", {
    email: opts.email,
    plan: opts.planCode,
    callback_url: opts.callbackUrl,
    metadata: opts.metadata ?? {},
  });
  return resp.data;
}

/**
 * Verify the Paystack webhook signature: HMAC-SHA512 of the RAW body, keyed by
 * the Paystack secret key, compared against `x-paystack-signature`.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha512", secretKey()).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
