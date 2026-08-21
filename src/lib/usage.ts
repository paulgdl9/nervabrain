import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@/lib/atomic-write";

// Per-tenant monthly meter for AI operations that spend the operator's API
// budget. Server-side app data, not vault content: one JSON file per calendar
// month under data/usage/. Feeds two things — the assistant fair-use quota and
// a monthly cost estimate per tenant.

export type UsageFeature = "brief" | "weekly" | "inbox" | "assistant";

type MonthUsage = { month: string; counts: Partial<Record<UsageFeature, number>> };

// Per-call cost in USD, mid-range from Matrice-Couts-IA.md (Sonnet, chat in
// Opus, before prompt caching — deliberately conservative). Calibrate against
// real token counts before trusting the total as a billing figure.
const PER_CALL_COST_USD: Record<UsageFeature, number> = {
  brief: 0.09,
  weekly: 0.15,
  inbox: 0.035,
  assistant: 0.075,
};

function usageDir(): string {
  return process.env.USAGE_DIR?.trim() || path.join(process.cwd(), "data", "usage");
}

export function usageMonthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

function monthFile(month: string): string {
  return path.join(usageDir(), `${month}.json`);
}

async function readMonth(month: string): Promise<MonthUsage> {
  try {
    const parsed = JSON.parse(await fs.readFile(monthFile(month), "utf8")) as MonthUsage;
    return { month, counts: parsed.counts ?? {} };
  } catch {
    return { month, counts: {} };
  }
}

// ponytail: read-modify-write, not atomic across the read. One tenant is a
// single Next process and AI ops are low-frequency (the scheduler serializes
// brief/weekly), so a lost increment is rare and only under-counts a fair-use
// meter — acceptable. Add a per-file lock if concurrent assistant calls ever
// make it matter.
export async function recordUsage(feature: UsageFeature, month = usageMonthKey()): Promise<void> {
  const usage = await readMonth(month);
  usage.counts[feature] = (usage.counts[feature] ?? 0) + 1;
  await atomicWriteFile(monthFile(month), JSON.stringify(usage, null, 2));
}

export async function usageCount(feature: UsageFeature, month = usageMonthKey()): Promise<number> {
  return (await readMonth(month)).counts[feature] ?? 0;
}

export async function monthlyCostEstimateUsd(month = usageMonthKey()): Promise<number> {
  const { counts } = await readMonth(month);
  let total = 0;
  for (const feature of Object.keys(PER_CALL_COST_USD) as UsageFeature[]) {
    total += (counts[feature] ?? 0) * PER_CALL_COST_USD[feature];
  }
  return Math.round(total * 100) / 100;
}
