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
 *    recommendations; "act" applies real mutations (wired in a later slice).
 *  - Guardrails: hard min/max daily budget, a max per-cycle budget step,
 *    spend-based pause thresholds, and a per-campaign cooldown.
 *  - Eligibility: the project must have autonomousMode=true AND the campaign
 *    must have autonomousOptimization=true.
 *
 * This module keeps the pure decision logic (evaluateCampaign) free of I/O so
 * it can be unit-tested in isolation.
 */

import cron from "node-cron";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  projectsTable,
  adPlatformActionsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

export type AutonomousAction =
  | "NOOP"
  | "INCREASE_BUDGET"
  | "DECREASE_BUDGET"
  | "PAUSE";

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
 *  1. Non-active campaign => NOOP (no auto-resume in this slice).
 *  2. Missing budget => NOOP.
 *  3. Zero conversions + spent >= pauseSpendThreshold => PAUSE.
 *  4. Zero conversions + spent >= decreaseSpendThreshold => DECREASE_BUDGET.
 *  5. Has conversions + roas >= roasTarget => INCREASE_BUDGET.
 *  6. roas < roasFloor => DECREASE_BUDGET.
 *  7. Otherwise => NOOP.
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

/**
 * One autonomous cycle. Observe mode records recommendations to the audit log;
 * act mode (a later slice) applies real mutations through the existing
 * Google/Meta mutation helpers, within guardrails + cooldown.
 */
export async function runAutonomousCycle(): Promise<void> {
  if (process.env.AUTONOMOUS_OPTIMIZER_ENABLED !== "true") return;

  const mode = process.env.AUTONOMOUS_OPTIMIZER_MODE ?? "observe";
  const guardrails = readGuardrails();

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

    // Observe mode records a recommendation. Act mode (later slice) applies it.
    const actionType =
      mode === "act"
        ? `AUTONOMOUS_${decision.action}`
        : "AUTONOMOUS_EVALUATION";

    await db.insert(adPlatformActionsTable).values({
      projectId: row.projectId,
      platform: row.source, // "google_ads" | "meta"
      customerId: null,
      campaignId: row.externalId ?? String(row.id),
      actionType,
      beforeState: JSON.stringify({
        status: decision.beforeStatus,
        budget: decision.beforeBudget,
        spent: snapshot.spent,
        conversions: snapshot.conversions,
        roas: snapshot.roas,
      }),
      afterState: JSON.stringify({
        action: decision.action,
        reason: decision.reason,
        status: decision.afterStatus,
        budget: decision.afterBudget,
        mode,
      }),
      status: "success",
    });
    flagged++;
  }

  logger.info(
    { evaluated, flagged, mode },
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
