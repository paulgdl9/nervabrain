import { todayISO } from "@/lib/dates";
import { activeModuleEvidence, getDashboard, readSetupState } from "@/lib/vault";
import { summarizeDashboardModules } from "@/lib/dashboard-modules";
import { readSnapshots, recordSnapshot, type DailySnapshot } from "@/lib/snapshots";

/**
 * Record today's dashboard metrics once per day so the module blocks can draw
 * real trend sparklines. Idempotent: skips if today is already the latest
 * recorded point. Returns whether it wrote.
 */
export async function recordDailySnapshot(): Promise<boolean> {
  const today = todayISO();
  const history = await readSnapshots();
  if (history.at(-1)?.date === today) return false;

  const [setup, dashboard] = await Promise.all([readSetupState(), getDashboard()]);
  const summary = summarizeDashboardModules(
    dashboard.allNotes,
    activeModuleEvidence(dashboard.allNotes, setup.modules),
    setup.currency,
    today,
  );

  const entry: DailySnapshot = { date: today };
  if (summary.finance) entry.netWorth = summary.finance.total;
  if (summary.budget) entry.available = summary.budget.available;
  if (summary.business) {
    entry.pipeline = summary.business.pipeline;
    entry.revenue = summary.business.revenue;
  }
  if (summary.training?.readiness != null) entry.readiness = summary.training.readiness;

  // Nothing but the date means no active module has a value worth trending yet.
  if (Object.keys(entry).length === 1) return false;
  await recordSnapshot(entry);
  return true;
}
