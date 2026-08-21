import fs from "node:fs/promises";
import { atomicWriteFile } from "@/lib/atomic-write";
import { DASHBOARD_WIDGET_IDS } from "@/lib/dashboard-modules";
import { resolveVaultPath } from "@/lib/vault";

const DASHBOARD_LAYOUT_FILE = ".second-brain-dashboard-layout.json";
const WORKSPACE_APPEARANCE_FILE = ".second-brain-workspace-appearance.json";

export type DashboardCustomBlock = {
  id: string;
  kind: "text" | "metric" | "progress" | "links";
  title: string;
  body: string;
  value: string;
};

export type DashboardLayoutPreference = {
  order: string[];
  hidden: string[];
  custom: DashboardCustomBlock[];
  sizes: Record<string, "standard" | "wide">;
};

export type WorkspaceAppearancePreference = {
  customAreas: string[];
  hiddenAreas: string[];
  areaColors: Record<string, string>;
};

export const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearancePreference = {
  customAreas: [],
  hiddenAreas: [],
  areaColors: {},
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function uniqueStrings(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

export function normalizeDashboardLayoutPreference(value: unknown): DashboardLayoutPreference {
  const input = record(value);
  const custom = Array.isArray(input.custom)
    ? input.custom.flatMap((item): DashboardCustomBlock[] => {
        const block = record(item);
        const id = String(block.id || "");
        const kind = String(block.kind || "");
        if (!/^custom:[a-zA-Z0-9_-]{1,100}$/.test(id) || !["text", "metric", "progress", "links"].includes(kind)) return [];
        return [{
          id,
          kind: kind as DashboardCustomBlock["kind"],
          title: String(block.title || "").slice(0, 200),
          body: String(block.body || "").slice(0, 20_000),
          value: String(block.value || "").slice(0, 500),
        }];
      }).slice(0, 100)
    : [];
  const valid = new Set<string>([...DASHBOARD_WIDGET_IDS, ...custom.map((block) => block.id)]);
  const hidden = uniqueStrings(input.hidden).filter((id) => valid.has(id));
  const hiddenSet = new Set(hidden);
  const order = uniqueStrings(input.order).filter((id) => valid.has(id) && !hiddenSet.has(id));
  const seen = new Set([...order, ...hidden]);
  for (const id of valid) if (!seen.has(id)) order.push(id);
  const sizes = Object.fromEntries(
    Object.entries(record(input.sizes))
      .filter(([id, size]) => valid.has(id) && (size === "standard" || size === "wide")),
  ) as DashboardLayoutPreference["sizes"];
  return { order, hidden, custom, sizes };
}

export function normalizeWorkspaceAppearancePreference(value: unknown): WorkspaceAppearancePreference {
  const input = record(value);
  const areaColors = Object.fromEntries(
    Object.entries(record(input.areaColors))
      .flatMap(([area, color]) => {
        const name = area.trim().slice(0, 160);
        const hex = String(color).trim().toLowerCase();
        return name && /^#[0-9a-f]{6}$/.test(hex) ? [[name, hex]] : [];
      })
      .slice(0, 200),
  );
  return {
    customAreas: uniqueStrings(input.customAreas, 200).map((area) => area.slice(0, 160)),
    hiddenAreas: uniqueStrings(input.hiddenAreas, 200).map((area) => area.slice(0, 160)),
    areaColors,
  };
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(resolveVaultPath(file), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export async function readDashboardLayoutPreference(): Promise<DashboardLayoutPreference | null> {
  const stored = await readJson(DASHBOARD_LAYOUT_FILE);
  return stored === null ? null : normalizeDashboardLayoutPreference(stored);
}

export async function saveDashboardLayoutPreference(value: unknown): Promise<DashboardLayoutPreference> {
  const preference = normalizeDashboardLayoutPreference(value);
  await atomicWriteFile(resolveVaultPath(DASHBOARD_LAYOUT_FILE), `${JSON.stringify({ version: 1, ...preference }, null, 2)}\n`);
  return preference;
}

export async function readWorkspaceAppearancePreference(): Promise<WorkspaceAppearancePreference | null> {
  const stored = await readJson(WORKSPACE_APPEARANCE_FILE);
  return stored === null ? null : normalizeWorkspaceAppearancePreference(stored);
}

export async function saveWorkspaceAppearancePreference(value: unknown): Promise<WorkspaceAppearancePreference> {
  const preference = normalizeWorkspaceAppearancePreference(value);
  await atomicWriteFile(resolveVaultPath(WORKSPACE_APPEARANCE_FILE), `${JSON.stringify({ version: 1, ...preference }, null, 2)}\n`);
  return preference;
}
