import { db } from "@workspace/db";
import { videoConfigTable } from "@workspace/db";

export const VIDEO_CONFIG_DEFAULTS: Record<string, string> = {
  kling_cost_per_credit_usd:    "0.145",
  retail_price_per_second_usd:  "1.25",
  low_balance_warning_pct:      "25",
  trial_monthly_seconds:        "0",
  starter_monthly_seconds:      "45",
  get_going_monthly_seconds:    "120",
  growth_monthly_seconds:       "300",
  agency_monthly_seconds:       "720",
};

let _configCache: Record<string, string> | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000;

export async function getVideoConfig(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_configCache && now - _cacheTime < CACHE_TTL_MS) return _configCache;

  const rows = await db.select().from(videoConfigTable);
  const config: Record<string, string> = { ...VIDEO_CONFIG_DEFAULTS };
  for (const row of rows) config[row.key] = row.value;

  _configCache = config;
  _cacheTime = now;
  return config;
}

export async function setVideoConfig(key: string, value: string, description?: string): Promise<void> {
  await db
    .insert(videoConfigTable)
    .values({ key, value, description: description ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: videoConfigTable.key,
      set: { value, updatedAt: new Date() },
    });
  _configCache = null;
}

export async function setVideoConfigs(updates: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) await setVideoConfig(key, value);
}

export function invalidateVideoConfigCache(): void {
  _configCache = null;
}

export async function getMonthlySecondsByPlan(plan: string): Promise<number> {
  const config = await getVideoConfig();
  const key = `${plan.replace(/-/g, "_")}_monthly_seconds`;
  const raw = config[key];
  if (raw !== undefined) return Math.max(0, parseInt(raw, 10) || 0);
  return 0;
}

export const CREDIT_BUNDLES: Array<{ seconds: number; priceUsd: number; label: string }> = [
  { seconds: 5,   priceUsd: 6.25,   label: "5 seconds"   },
  { seconds: 15,  priceUsd: 18.75,  label: "15 seconds"  },
  { seconds: 30,  priceUsd: 37.50,  label: "30 seconds"  },
  { seconds: 60,  priceUsd: 75.00,  label: "60 seconds"  },
  { seconds: 120, priceUsd: 150.00, label: "120 seconds" },
];

export function getBundleBySeconds(seconds: number): (typeof CREDIT_BUNDLES)[number] | null {
  return CREDIT_BUNDLES.find((b) => b.seconds === seconds) ?? null;
}
