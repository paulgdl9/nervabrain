import { isWorkspaceHistory } from "@/lib/workspace-history";

export type DashboardObjectivePriority = "high" | "medium" | "low" | "none";

export function dashboardObjectivePriority(raw: unknown): DashboardObjectivePriority {
  const value = String(raw ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/haut|high|urgent|elev|p?1\b/.test(value)) return "high";
  if (/moy|med|normal|p?2\b/.test(value)) return "medium";
  if (/bas|low|p?3\b/.test(value)) return "low";
  return "none";
}

export function isSelectableDashboardObjective(status: string, priority: unknown) {
  return !isWorkspaceHistory("objective", status)
    && (status.trim().toLowerCase() === "active" || dashboardObjectivePriority(priority) === "high");
}

export function keepDashboardObjectiveProgress(priority: DashboardObjectivePriority, progress: number) {
  return priority === "high" || progress < 100;
}

/**
 * Jours écoulés depuis le dernier signe de vie d'un objectif (mtime ISO de sa
 * note ou d'une tâche reliée). Sert au badge « sans activité » du dashboard.
 */
export function objectiveStaleDays(todayIso: string, lastTouch?: string) {
  // Jours calendaires : "6 j" pour une note d'il y a une semaine se lirait faux,
  // donc on ignore l'heure du mtime et on ne compare que les dates.
  const touched = lastTouch ? Date.parse(lastTouch.slice(0, 10)) : NaN;
  if (!Number.isFinite(touched)) return 0;
  return Math.max(0, Math.floor((Date.parse(todayIso) - touched) / 86_400_000));
}
