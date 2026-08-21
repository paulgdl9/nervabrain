import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile, withFileWriteLock } from "@/lib/atomic-write";
import { resolveVaultPath } from "@/lib/vault";

export type DailyBriefJobState = {
  status: "idle" | "running" | "succeeded" | "failed";
  id?: string;
  startedAt?: string;
  finishedAt?: string;
  generatedBy?: string;
  path?: string;
  error?: string;
};

const STATE_FILE = "00-System/.daily-brief-job.json";
const STALE_AFTER_MS = 15 * 60 * 1000;

function statePath() {
  return resolveVaultPath(STATE_FILE);
}

function normalize(value: unknown): DailyBriefJobState {
  if (!value || typeof value !== "object") return { status: "idle" };
  const raw = value as Partial<DailyBriefJobState>;
  if (!raw.status || !["idle", "running", "succeeded", "failed"].includes(raw.status)) return { status: "idle" };
  if (raw.status === "running" && raw.startedAt) {
    const started = Date.parse(raw.startedAt);
    if (Number.isFinite(started) && Date.now() - started > STALE_AFTER_MS) {
      return { ...raw, status: "failed", error: "La génération précédente a été interrompue. Vous pouvez la relancer." };
    }
  }
  return raw as DailyBriefJobState;
}

export async function readDailyBriefJob(): Promise<DailyBriefJobState> {
  try {
    return normalize(JSON.parse(await fs.readFile(statePath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[daily-brief-job] failed to read state", error);
    return { status: "idle" };
  }
}

async function writeDailyBriefJob(state: DailyBriefJobState) {
  await atomicWriteFile(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export async function beginDailyBriefJob(): Promise<{ started: boolean; state: DailyBriefJobState }> {
  return withFileWriteLock(`${statePath()}.start`, async () => {
    const current = await readDailyBriefJob();
    if (current.status === "running") return { started: false, state: current };
    const state: DailyBriefJobState = {
      status: "running",
      id: randomUUID(),
      startedAt: new Date().toISOString(),
    };
    await writeDailyBriefJob(state);
    return { started: true, state };
  });
}

export async function finishDailyBriefJob(
  id: string,
  result: { generatedBy: string; path: string } | { error: string },
) {
  await withFileWriteLock(`${statePath()}.finish`, async () => {
    const current = await readDailyBriefJob();
    if (current.id !== id) return;
    const finishedAt = new Date().toISOString();
    await writeDailyBriefJob("error" in result
      ? { ...current, status: "failed", finishedAt, error: result.error }
      : { ...current, status: "succeeded", finishedAt, generatedBy: result.generatedBy, path: result.path, error: undefined });
  });
}
