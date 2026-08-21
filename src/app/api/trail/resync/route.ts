import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { loadTrailData } from "@/lib/trail";

export const runtime = "nodejs";

// The app and the profile's Garmin worker share data/garmin. Dropping a file
// there triggers the isolated worker without a Docker socket or host service.
const TRIGGER_FILE = path.join(process.cwd(), "data", "garmin", "sync.request");
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 40_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true })) return unauthorizedResponse();

  const before = (await loadTrailData()).generatedAt;

  try {
    await fs.mkdir(path.dirname(TRIGGER_FILE), { recursive: true });
    await fs.writeFile(TRIGGER_FILE, `${new Date().toISOString()}\n`, { mode: 0o644 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Déclenchement impossible" },
      { status: 500 },
    );
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const generatedAt = (await loadTrailData()).generatedAt;
    if (generatedAt && generatedAt !== before) {
      return NextResponse.json({ ok: true, generatedAt });
    }
  }

  // Garmin can occasionally answer slowly; the worker continues after this response.
  return NextResponse.json(
    { ok: false, error: "La synchronisation prend plus de temps que prévu. Réessaie dans un instant.", pending: true },
    { status: 504 },
  );
}
