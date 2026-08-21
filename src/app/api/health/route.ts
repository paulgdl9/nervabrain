import fs from "node:fs/promises";
import { constants } from "node:fs";
import { NextResponse } from "next/server";
import { vaultRoot } from "@/lib/vault";

export const runtime = "nodejs";

export async function GET() {
  try {
    await fs.access(vaultRoot(), constants.R_OK | constants.W_OK);
    return NextResponse.json({ ok: true, now: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { ok: false, status: "vault-unavailable", now: new Date().toISOString() },
      { status: 503 },
    );
  }
}
