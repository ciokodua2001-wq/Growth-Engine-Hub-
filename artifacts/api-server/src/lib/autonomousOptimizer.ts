/**
 * Autonomous campaign optimizer.
 *
 * The decision engine behind "autonomous marketing": it reads per-campaign
 * performance (already synced into the campaigns table by the Google/Meta sync
 * endpoints), applies deterministic, guardrail-bounded rules, and writes an
 * audit trail. It works for BOTH Google Ads and Meta Ads.
 *
 * Safety model (deliberately conservative — these are real ad accounts):
 *  - Global kill switch: AUTONOMOUS_OPTIMIZER_ENABLED !== "true" => no-op.
 *  - Mode: AUTONOMOUS_OPTIMIZER_MODE = "observe" (default) records only
 *    recommendations; "act" applies real status/budget mutations.
 *  - Guardrails: hard min/max daily budget, a max per-cycle budget step,
 *    spend-based pause thresholds, and a per-campaign cooldown.
 *  - Resume is recommendation-only: a paused campaign with historical
 *    performance yields a RESUME recommendation that is NEVER auto-applied
 *    (explicit customer authorization is required to actually resume).
 *  - Eligibility: the project must have autonomousMode=true AND the campaign
 *    must have autonomousOptimization=true.
 *
 * The pure decision logic (evaluateCampaign, computeBudgetStep, isCooldownActive)
 * is free of I/O so it can be unit-tested in isolation.
 */

import cron from "node-cron";
import { and, eq, inArray, desc } from "drizzle-orm";
import { GoogleAdsApi } from "google-ads-api";
import {
  db,
  campaignsTable,
  projectsTable,
  connectedAdAccountsTable,
  adPlatformActionsTable,
} from "@workspace/db";
import { logger } from "./logger.js";
import {
  updateMetaCampaignStatus,
  updateMetaAdSetBudget,
  queryMetaAdSetId,
  dollarsToCents,
} from "./metaAdsMutations.js";
import {
  updateCampaignStatus,
  updateCampaignBudgetAmount,
  queryCampaignBudgetResourceName,
  dollarsToMicros,
} from "./googleAdsMutations.js";
import { syncGoogleMetrics, syncMetaMetrics } from "./adMetricsSync.js";

export type AutonomousAction =
  | "NOOP"
  | "INCREASE_BUDGET"
  | "DECREASE_BUDGET"
  | "PAUSE"
  | "RESUME";

export interface Guardrails {
  /** Hard floor for any daily budget (USD). */
  minDailyBudget: number;
  /** Hard ceiling for any daily budget (USD). */
  maxDailyBudget: number;
  /** Max fractional budget change per cycle, e.g. 0.2 = ±20%. */
  budgetStepPct: number;
  /** ROAS at/above which a campaign is considered a proven winner. */
  roasTarget: number;
  /** ROAS below which a spending campaign is considered underperforming. */
  roasFloor: number;
  /** Pause a campaign once it has spent this much with zero conversions. */
  pauseSpendThreshold: number;
  /** Decrease budget once a campaign has spent this much with zero conversions. */
  decreaseSpendThreshold: number;
  /** Minimum minutes between applied mutations for a single campaign. */
  cooldownMinutes: number;
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  minDailyBudget: 1,
  maxDailyBudget: 200,
  budgetStepPct: 0.2,
  roasTarget: 2.0,
  roasFloor: 1.0,
  pauseSpendThreshold: 50,
  decreaseSpendThreshold: 20,
  cooldownMinutes: 360,
};

export interface CampaignSnapshot {
  id: number;
  projectId: number;
  externalId: string | null;
  /** "google_ads" | "meta" — the platform discriminator on the campaigns table. */
  source: string;
  status: string;
  budget: number | null;
  spent: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  roas: number | null;
  ctr: number | null;
  cpc: number | null;
}

export interface AutonomousDecision {
  action: AutonomousAction;
  reason: string;
  beforeBudget: number | null;
  afterBudget: number | null;
  beforeStatus: string;
  afterStatus: string;
}

/** Coerce a possibly-string DB value (drizzle numeric) into a finite number. */
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Step a budget up or down by budgetStepPct, clamped to [min, max]. */
export function computeBudgetStep(
  current: number,
  direction: "up" | "down",
  g: Guardrails,
): number {
  const step = current * g.budgetStepPct;
  const raw = direction === "up" ? current + step : current - step;
  return round2(Math.min(g.maxDailyBudget, Math.max(g.minDailyBudget, raw)));
}

/**
 * Deterministic decision engine (pure — no I/O).
 *
 * Rules, evaluated in priority order:
 *  1. Paused + historical performance => RESUME (recommendation-only, never
 *     auto-applied).
 *  2. Non-active (completed/archived/draft) => NOOP.
 *  3. Missing budget => NOOP.
 *  4. Zero conversions + spent >= pauseSpendThreshold => PAUSE.
 *  5. Zero conversions + spent >= decreaseSpendThreshold => DECREASE_BUDGET.
 *  6. Has conversions + roas >= roasTarget => INCREASE_BUDGET.
 *  7. roas < roasFloor => DECREASE_BUDGET.
 *  8. Otherwise => NOOP.
 */
export function evaluateCampaign(
  snapshot: CampaignSnapshot,
  g: Guardrails = DEFAULT_GUARDRAILS,
): AutonomousDecision {
  const budget = snapshot.budget;
  const spent = snapshot.spent ?? 0;
  const conversions = snapshot.conversions ?? 0;
  const roas = snapshot.roas;
  const active = snapshot.status === "active";

  if (snapshot.status === "paused") {
    const historicalConversions = snapshot.conversions ?? 0;
    const historicalSpent = snapshot.spent ?? 0;
    const historicalRoas = snapshot.roas;
    const hasHistoricalPerformance =
      historicalConversions > 0 ||
      (historicalSpent > 0 && historicalRoas != null && historicalRoas >= g.roasTarget);
    if (hasHistoricalPerformance) {
      return {
        action: "RESUME",
        reason: `paused campaign previously generated ${historicalConversions} conversions (spent $${historicalSpent.toFixed(2)}) — recommend resume for manual authorization`,
        beforeBudget: budget,
        afterBudget: budget,
        beforeStatus: "paused",
        afterStatus: "active",
      };
    }
    return {
      action: "NOOP",
      reason: "paused campaign has no historical performance to justify resume",
      beforeBudget: budget,
      afterBudget: budget,
      beforeStatus: snapshot.status,
      afterStatus: snapshot.status,
    };
  }

  if (!active) {
    return {
      action: "NOOP",
      reason: "campaign is not active",
      beforeBudget: budget,
      afterBudget: budget,
      beforeStatus: snapshot.status,
      afterStatus: snapshot.status,
    };
  }
  if (budget == null || budget <= 0) {
    return {
      action: "NOOP",
      reason: "no daily budget configured",
      beforeBudget: budget,
      afterBudget: budget,
      beforeStatus: snapshot.status,
      afterStatus: snapshot.status,
    };
  }

  if (conversions === 0 && spent >= g.pauseSpendThreshold) {
    return {
      action: "PAUSE",
      reason: `spent $${spent.toFixed(2)} with zero conversions`,
      beforeBudget: budget,
      afterBudget: budget,
      beforeStatus: snapshot.status,
      afterStatus: "paused",
    };
  }
  if (conversions === 0 && spent >= g.decreaseSpendThreshold) {
    return {
      action: "DECREASE_BUDGET",
      reason: `spent $${spent.toFixed(2)} with zero conversions`,
      beforeBudget: budget,
      afterBudget: computeBudgetStep(budget, "down", g),
      beforeStatus: snapshot.status,
      afterStatus: snapshot.status,
    };
  }
  if (conversions > 0 && roas != null && roas >= g.roasTarget) {
    return {
      action: "INCREASE_BUDGET",
      reason: `ROAS ${roas.toFixed(2)} >= target ${g.roasTarget}`,
      beforeBudget: budget,
      afterBudget: computeBudgetStep(budget, "up", g),
      beforeStatus: snapshot.status,
      afterStatus: snapshot.status,
    };
  }
  if (roas != null && roas < g.roasFloor) {
    return {
      action: "DECREASE_BUDGET",
      reason: `ROAS ${roas.toFixed(2)} below floor ${g.roasFloor}`,
      beforeBudget: budget,
      afterBudget: computeBudgetStep(budget, "down", g),
      beforeStatus: snapshot.status,
      afterStatus: snapshot.status,
    };
  }

  return {
    action: "NOOP",
    reason: "within guardrails",
    beforeBudget: budget,
    afterBudget: budget,
    beforeStatus: snapshot.status,
    afterStatus: snapshot.status,
  };
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Load guardrails from env, falling back to conservative defaults. */
export function readGuardrails(): Guardrails {
  return {
    minDailyBudget: envNum("AUTONOMOUS_MIN_DAILY_BUDGET", DEFAULT_GUARDRAILS.minDailyBudget),
    maxDailyBudget: envNum("AUTONOMOUS_MAX_DAILY_BUDGET", DEFAULT_GUARDRAILS.maxDailyBudget),
    budgetStepPct: envNum("AUTONOMOUS_BUDGET_STEP_PCT", DEFAULT_GUARDRAILS.budgetStepPct),
    roasTarget: envNum("AUTONOMOUS_ROAS_TARGET", DEFAULT_GUARDRAILS.roasTarget),
    roasFloor: envNum("AUTONOMOUS_ROAS_FLOOR", DEFAULT_GUARDRAILS.roasFloor),
    pauseSpendThreshold: envNum("AUTONOMOUS_PAUSE_SPEND", DEFAULT_GUARDRAILS.pauseSpendThreshold),
    decreaseSpendThreshold: envNum("AUTONOMOUS_DECREASE_SPEND", DEFAULT_GUARDRAILS.decreaseSpendThreshold),
    cooldownMinutes: envNum("AUTONOMOUS_COOLDOWN_MINUTES", DEFAULT_GUARDRAILS.cooldownMinutes),
  };
}

// ── Apply layer (act mode) ─────────────────────────────────────────────────────

const APPLIED_AUTONOMOUS_ACTIONS = [
  "AUTONOMOUS_INCREASE_BUDGET",
  "AUTONOMOUS_DECREASE_BUDGET",
  "AUTONOMOUS_PAUSE",
] as const;

/** Pure cooldown check (unit-testable). */
export function isCooldownActive(
  lastAppliedAt: Date | null,
  cooldownMinutes: number,
  now: Date = new Date(),
): boolean {
  if (cooldownMinutes <= 0) return false;
  if (!lastAppliedAt) return false;
  return now.getTime() - lastAppliedAt.getTime() < cooldownMinutes * 60_000;
}

function makeGoogleCustomer(refreshToken: string, customerId: string) {
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
  });
  return client.Customer({ customer_id: customerId, refresh_token: refreshToken });
}

async function resolveAccount(projectId: number, provider: "google_ads" | "meta") {
  const [account] = await db
    .select()
    .from(connectedAdAccountsTable)
    .where(
      and(
        eq(connectedAdAccountsTable.projectId, projectId),
        eq(connectedAdAccountsTable.provider, provider),
      ),
    );
  return account ?? null;
}

async function lastAppliedAt(projectId: number, campaignId: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: adPlatformActionsTable.createdAt })
    .from(adPlatformActionsTable)
    .where(
      and(
        eq(adPlatformActionsTable.projectId, projectId),
        eq(adPlatformActionsTable.campaignId, campaignId),
        eq(adPlatformActionsTable.status, "success"),
        inArray(adPlatformActionsTable.actionType, [...APPLIED_AUTONOMOUS_ACTIONS]),
      ),
    )
    .orderBy(desc(adPlatformActionsTable.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

async function applyMetaDecision(
  accessToken: string,
  campaignId: string,
  decision: AutonomousDecision,
): Promise<void> {
  if (decision.action === "PAUSE") {
    await updateMetaCampaignStatus(accessToken, campaignId, "PAUSED");
    return;
  }
  if (decision.action === "INCREASE_BUDGET" || decision.action === "DECREASE_BUDGET") {
    const after = decision.afterBudget;
    if (after == null || after <= 0) throw new Error("Budget decision has no valid target");
    const adSetId = await queryMetaAdSetId(accessToken, campaignId);
    if (!adSetId) throw new Error("Meta ad set not found for campaign — cannot update budget");
    await updateMetaAdSetBudget(accessToken, adSetId, dollarsToCents(after));
  }
}

async function applyGoogleDecision(
  refreshToken: string,
  customerId: string,
  campaignId: string,
  decision: AutonomousDecision,
): Promise<void> {
  const customer = makeGoogleCustomer(refreshToken, customerId);
  if (decision.action === "PAUSE") {
    await updateCampaignStatus(customer, customerId, campaignId, "PAUSED");
    return;
  }
  if (decision.action === "INCREASE_BUDGET" || decision.action === "DECREASE_BUDGET") {
    const after = decision.afterBudget;
    if (after == null || after <= 0) throw new Error("Budget decision has no valid target");
    const budgetResourceName = await queryCampaignBudgetResourceName(customer, campaignId);
    if (!budgetResourceName) throw new Error("Google Ads campaign budget not found");
    await updateCampaignBudgetAmount(customer, budgetResourceName, dollarsToMicros(after));
  }
}

async function recordAutonomousAction(input: {
  projectId: number;
  platform: string;
  customerId: string | null;
  campaignId: string;
  action: AutonomousAction;
  mode: string;
  before: unknown;
  after: unknown;
  status: "success" | "failed";
  errorMessage?: string | null;
}): Promise<void> {
  const actionType =
    input.mode === "act" ? `AUTONOMOUS_${input.action}` : "AUTONOMOUS_EVALUATION";
  await db.insert(adPlatformActionsTable).values({
    projectId: input.projectId,
    platform: input.platform,
    customerId: input.customerId,
    campaignId: input.campaignId,
    actionType,
    beforeState: JSON.stringify(input.before),
    afterState: JSON.stringify(input.after),
    status: input.status,
    errorMessage: input.errorMessage ?? null,
  });
}

/**
 * One autonomous cycle. Observe mode records recommendations to the audit log;
 * act mode applies real status/budget mutations within guardrails + cooldown.
 */
export async function runAutonomousCycle(): Promise<void> {
  if (process.env.AUTONOMOUS_OPTIMIZER_ENABLED !== "true") return;

  const mode = process.env.AUTONOMOUS_OPTIMIZER_MODE ?? "observe";
  const applyEnabled = mode === "act";
  const guardrails = readGuardrails();

  // Sync fresh metrics for every connected provider of autonomous projects,
  // so decisions reflect current performance (best-effort, non-fatal).
  const accounts = await db
    .select({
      projectId: connectedAdAccountsTable.projectId,
      provider: connectedAdAccountsTable.provider,
    })
    .from(connectedAdAccountsTable)
    .innerJoin(projectsTable, eq(connectedAdAccountsTable.projectId, projectsTable.id))
    .where(eq(projectsTable.autonomousMode, true));

  for (const a of accounts) {
    try {
      if (a.provider === "google_ads") await syncGoogleMetrics(a.projectId);
      else if (a.provider === "meta") await syncMetaMetrics(a.projectId);
    } catch (err) {
      logger.warn(
        { err, projectId: a.projectId, provider: a.provider },
        "Autonomous optimizer: metrics sync failed (skipping)",
      );
    }
  }

  const rows = await db
    .select({
      id: campaignsTable.id,
      projectId: campaignsTable.projectId,
      externalId: campaignsTable.externalId,
      source: campaignsTable.source,
      status: campaignsTable.status,
      budget: campaignsTable.budget,
      spent: campaignsTable.spent,
      impressions: campaignsTable.impressions,
      clicks: campaignsTable.clicks,
      conversions: campaignsTable.conversions,
      roas: campaignsTable.roas,
      ctr: campaignsTable.ctr,
      cpc: campaignsTable.cpc,
    })
    .from(campaignsTable)
    .innerJoin(projectsTable, eq(campaignsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(campaignsTable.autonomousOptimization, true),
        eq(projectsTable.autonomousMode, true),
        inArray(campaignsTable.source, ["google_ads", "meta"]),
      ),
    );

  let evaluated = 0;
  let flagged = 0;
  let applied = 0;
  let failed = 0;
  let cooldownSkipped = 0;

  for (const row of rows) {
    const snapshot: CampaignSnapshot = {
      id: row.id,
      projectId: row.projectId,
      externalId: row.externalId,
      source: row.source,
      status: row.status,
      budget: num(row.budget),
      spent: num(row.spent),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      conversions: num(row.conversions),
      roas: num(row.roas),
      ctr: num(row.ctr),
      cpc: num(row.cpc),
    };

    const decision = evaluateCampaign(snapshot, guardrails);
    evaluated++;
    if (decision.action === "NOOP") continue;
    flagged++;

    const platform = row.source; // "google_ads" | "meta"
    const campaignId = row.externalId ?? String(row.id);
    const before = {
      status: decision.beforeStatus,
      budget: decision.beforeBudget,
      spent: snapshot.spent,
      conversions: snapshot.conversions,
      roas: snapshot.roas,
    };
    const after = {
      action: decision.action,
      reason: decision.reason,
      status: decision.afterStatus,
      budget: decision.afterBudget,
      mode,
    };

    // Observe mode (and RESUME, which is recommendation-only): record and move on.
    const isResume = decision.action === "RESUME";
    if (!applyEnabled || isResume) {
      await recordAutonomousAction({
        projectId: row.projectId,
        platform,
        customerId: null,
        campaignId,
        action: decision.action,
        mode,
        before,
        after: isResume ? { ...after, requiresAuthorization: true } : after,
        status: "success",
      });
      continue;
    }

    // Act mode: apply the mutation, with hard safety checks.
    if (!row.externalId) {
      logger.warn(
        { projectId: row.projectId, internalId: row.id },
        "Autonomous optimizer: campaign has no external id — cannot apply",
      );
      continue;
    }

    const provider: "google_ads" | "meta" =
      row.source === "google_ads" ? "google_ads" : "meta";
    const account = await resolveAccount(row.projectId, provider);
    if (!account) {
      logger.warn(
        { projectId: row.projectId, provider },
        "Autonomous optimizer: no connected account — cannot apply",
      );
      continue;
    }
    if (provider === "google_ads" && (!account.refreshToken || !account.customerId)) {
      logger.warn(
        { projectId: row.projectId },
        "Autonomous optimizer: Google account missing refreshToken/customerId",
      );
      continue;
    }

    const lastAt = await lastAppliedAt(row.projectId, row.externalId);
    if (isCooldownActive(lastAt, guardrails.cooldownMinutes)) {
      cooldownSkipped++;
      continue;
    }

    try {
      if (provider === "google_ads") {
        await applyGoogleDecision(account.refreshToken!, account.customerId!, row.externalId, decision);
      } else {
        await applyMetaDecision(account.accessToken, row.externalId, decision);
      }

      // Reflect the change locally (status always; budget only when it changed).
      await db
        .update(campaignsTable)
        .set({
          status: decision.afterStatus,
          ...(decision.afterBudget != null && decision.afterBudget !== decision.beforeBudget
            ? { budget: String(decision.afterBudget) }
            : {}),
        })
        .where(eq(campaignsTable.id, row.id));

      await recordAutonomousAction({
        projectId: row.projectId,
        platform,
        customerId: account.customerId ?? null,
        campaignId: row.externalId,
        action: decision.action,
        mode,
        before,
        after,
        status: "success",
      });
      applied++;
    } catch (err) {
      failed++;
      await recordAutonomousAction({
        projectId: row.projectId,
        platform,
        customerId: account.customerId ?? null,
        campaignId: row.externalId,
        action: decision.action,
        mode,
        before,
        after,
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Apply failed",
      });
      logger.error(
        { err, projectId: row.projectId, campaignId: row.externalId },
        "Autonomous optimizer: apply failed",
      );
    }
  }

  logger.info(
    { evaluated, flagged, applied, failed, cooldownSkipped, mode },
    "Autonomous optimizer: cycle complete",
  );
}

/** Start the autonomous optimizer cron. Safe no-op unless enabled in env. */
export function startAutonomousOptimizer(): void {
  const cronExpr = process.env.AUTONOMOUS_OPTIMIZER_CRON ?? "0 * * * *";
  const enabled = process.env.AUTONOMOUS_OPTIMIZER_ENABLED === "true";
  cron.schedule(cronExpr, async () => {
    try {
      await runAutonomousCycle();
    } catch (err) {
      logger.error({ err }, "Autonomous optimizer: cycle failed");
    }
  });
  logger.info(
    { cron: cronExpr, enabled, mode: process.env.AUTONOMOUS_OPTIMIZER_MODE ?? "observe" },
    "Autonomous optimizer started",
  );
}
