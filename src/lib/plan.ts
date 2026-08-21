// Per-tenant subscription plan and the feature flags it gates.
//
// The plan is profile-specific configuration: it lives in the tenant's `.env`
// as SECOND_BRAIN_PLAN, never in shared code or the vault. It defaults to "pro"
// so existing single-tenant deploys (including the operator's own instance)
// keep every feature until a plan is explicitly set.
//
// The original hosted-SaaS experiment gated every synthesis on the tenant
// plan. Nerva Brain is now distributed as a self-hosted product where the
// user connects their own AI account, so Daily, Weekly and capture routing are
// core product behavior on every plan. Assistant quota and Garmin remain
// separate legacy deployment concerns.

export type Plan = "free" | "plus" | "pro";

const PLANS = ["free", "plus", "pro"] as const;

export function getPlan(): Plan {
  const raw = (process.env.SECOND_BRAIN_PLAN || "").trim().toLowerCase();
  return (PLANS as readonly string[]).includes(raw) ? (raw as Plan) : "pro";
}

// Kept as a function so deployments can gain an explicit capability check
// later, but it deliberately does not depend on the commercial plan: the
// connected engine belongs to the self-hoster.
export function planAllowsAiSynthesis(): boolean {
  return true;
}

export function planAllowsAssistant(plan: Plan = getPlan()): boolean {
  return plan !== "free";
}

export function planAllowsGarmin(plan: Plan = getPlan()): boolean {
  return plan === "pro";
}

// Fair-use ceiling on in-app assistant messages per calendar month. 0 means the
// assistant is blocked entirely; Infinity means unmetered. Plus can be tuned per
// deployment via ASSISTANT_MONTHLY_QUOTA without a code change.
export function assistantMonthlyQuota(plan: Plan = getPlan()): number {
  if (plan === "free") return 0;
  if (plan === "pro") return Infinity;
  const override = Number(process.env.ASSISTANT_MONTHLY_QUOTA);
  return Number.isFinite(override) && override > 0 ? override : 200;
}
