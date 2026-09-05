export const PLAN_TIER_ORDER = ["trial", "starter", "get-going", "growth", "agency"] as const;

export function hasPlanBypass(user?: { isOwner?: boolean; role?: string } | null): boolean {
  if (!user) return false;
  return Boolean(user.isOwner) || user.role === "admin" || user.role === "super_admin";
}

/** True when this project is still on the free trial (owners/admins are never treated as trial). */
export function isTrialPlan(
  plan: string | undefined | null,
  user?: { isOwner?: boolean; role?: string } | null,
): boolean {
  if (hasPlanBypass(user)) return false;
  return plan === "trial";
}

/**
 * Returns true if `plan` is at or above `minPlan`. Owners/admins always pass.
 * Unknown/missing plans fail-open so the upgrade gate doesn't flash while the
 * project is still loading; the API remains the source of truth.
 */
export function meetsMinPlanClient(
  plan: string | undefined | null,
  minPlan: string,
  user?: { isOwner?: boolean; role?: string } | null,
): boolean {
  if (hasPlanBypass(user)) return true;
  if (!plan) return true;
  const tiers = PLAN_TIER_ORDER as readonly string[];
  const projectIdx = tiers.indexOf(plan);
  const minIdx = tiers.indexOf(minPlan);
  if (minIdx === -1) return true;
  if (projectIdx === -1) return true;
  return projectIdx >= minIdx;
}

/** Detects quota / plan-gate API errors so the UI can show an upgrade CTA instead of a generic failure. */
export function isUpgradeError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("trial limit reached") ||
    m.includes("monthly limit reached") ||
    m.includes("upgrade your plan") ||
    m.includes("upgrade to unlock") ||
    m.includes("upgrade to continue") ||
    m.includes("requires a paid plan") ||
    m.includes("paid plans only") ||
    /available on the .+ plan/.test(m)
  );
}
