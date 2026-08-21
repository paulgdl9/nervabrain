import { NextRequest, NextResponse } from "next/server";
import { processInbox } from "@/lib/vault";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!authenticateRequest(request, { scope: "write", allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 8 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const requestedLimit = Number(body?.limit || 5);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 25) : 5;
  const notes = await processInbox(limit);
  return NextResponse.json({ ok: true, count: notes.length, notes });
}
