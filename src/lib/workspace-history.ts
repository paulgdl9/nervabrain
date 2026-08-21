export type WorkspaceKind = "objective" | "task";

const HISTORY_STATUSES: Record<WorkspaceKind, ReadonlySet<string>> = {
  objective: new Set(["achieved", "completed", "abandoned", "archived"]),
  task: new Set(["done", "completed", "abandoned", "archived", "cancelled", "canceled"]),
};

export function isWorkspaceHistory(kind: WorkspaceKind, status: string): boolean {
  return HISTORY_STATUSES[kind].has(status.trim().toLowerCase());
}

export function filterWorkspaceHistory<T extends { status: string }>(
  kind: WorkspaceKind,
  items: readonly T[],
  includeHistory: boolean,
): T[] {
  return includeHistory ? [...items] : items.filter((item) => !isWorkspaceHistory(kind, item.status));
}
