import { createWorkoutGarminJson } from "@/lib/fit-workout";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import { loadTrainingPlan } from "@/lib/trail";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const GARMIN_DIR = path.join(process.cwd(), "data", "garmin");
const REQUEST_DIR = path.join(GARMIN_DIR, "publish-requests");
const RESULT_DIR = path.join(GARMIN_DIR, "publish-results");
const TRIGGER_FILE = path.join(GARMIN_DIR, "sync.request");
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 40_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requestKey(sessionId: string, scheduledDate: string) {
  return createHash("sha256").update(`${sessionId}:${scheduledDate}`).digest("hex");
}

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 4 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const scheduledDate = typeof body.scheduled_date === "string" ? body.scheduled_date : "";
  if (!sessionId || sessionId.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return NextResponse.json({ ok: false, error: "Séance ou date invalide" }, { status: 400 });
  }
  const plan = await loadTrainingPlan();
  const session = plan.weeks.flatMap((week) => week.sessions).find((item) => item.id === sessionId);
  if (!session || !["run", "ride", "strength"].includes(session.sport)) {
    return NextResponse.json({ ok: false, error: "Cette séance ne peut pas être envoyée à Garmin" }, { status: 400 });
  }

  const key = requestKey(sessionId, scheduledDate);
  const resultPath = path.join(RESULT_DIR, `${key}.json`);
  const result = async () => JSON.parse(await fs.readFile(resultPath, "utf8")) as { ok?: boolean; error?: string; workout_id?: number };
  try {
    const existing = await result();
    if (existing.ok) return NextResponse.json({ ok: true, ...existing, alreadyPublished: true });
  } catch {}

  try {
    const workout = createWorkoutGarminJson(session).data;
    await fs.mkdir(REQUEST_DIR, { recursive: true });
    await fs.mkdir(RESULT_DIR, { recursive: true });
    await fs.writeFile(path.join(REQUEST_DIR, `${key}.json`), `${JSON.stringify({ scheduled_date: scheduledDate, workout })}\n`, { mode: 0o600 });
    await fs.writeFile(TRIGGER_FILE, `${new Date().toISOString()}\n`, { mode: 0o644 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Envoi Garmin impossible" }, { status: 500 });
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const outcome = await result();
      return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
    } catch {}
  }
  return NextResponse.json({ ok: false, pending: true, error: "Garmin répond lentement. La demande continue en arrière-plan." }, { status: 202 });
}
