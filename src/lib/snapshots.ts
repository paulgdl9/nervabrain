import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "@/lib/atomic-write";

// Daily metric history for dashboard sparklines. This is derived telemetry, not
// knowledge, so it lives in app-owned `data/` (per profile, not synced) rather
// than the vault — no Syncthing churn, no Markdown parser to satisfy.
const SNAPSHOTS_FILE = path.join(process.cwd(), "data", "snapshots.json");
const KEEP_DAYS = 120;

export type DailySnapshot = {
  date: string; // YYYY-MM-DD
  netWorth?: number;
  available?: number;
  pipeline?: number;
  revenue?: number;
  readiness?: number;
};

/**
 * Replace any existing entry for the same date, keep the series sorted and
 * bounded to the most recent KEEP_DAYS. Pure so it is unit-testable.
 */
export function upsertSnapshot(history: DailySnapshot[], entry: DailySnapshot, keep = KEEP_DAYS): DailySnapshot[] {
  const merged = [...history.filter((item) => item.date !== entry.date), entry]
    .sort((a, b) => a.date.localeCompare(b.date));
  return merged.slice(-keep);
}

/** Series of one metric, in date order, for points that have it. */
export function snapshotSeries(history: DailySnapshot[], key: keyof DailySnapshot): number[] {
  return history
    .map((item) => item[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export async function readSnapshots(): Promise<DailySnapshot[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(SNAPSHOTS_FILE, "utf8"));
    return Array.isArray(parsed) ? (parsed as DailySnapshot[]) : [];
  } catch {
    return [];
  }
}

/** Idempotent per date: records today's metrics, overwriting an earlier same-day write. */
export async function recordSnapshot(entry: DailySnapshot): Promise<void> {
  const history = await readSnapshots();
  const next = upsertSnapshot(history, entry);
  await atomicWriteFile(SNAPSHOTS_FILE, `${JSON.stringify(next)}\n`);
}
