import { NextRequest, NextResponse } from "next/server";
import { updateCaptureStatus } from "@/lib/vault";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

const statuses = new Set(["inbox", "briefed", "processed", "archived"]);

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true, allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 16 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const path = typeof body?.path === "string" ? body.path : "";
  const status = typeof body?.status === "string" ? body.status : "";

  if (!path || !statuses.has(status)) {
    return NextResponse.json({ ok: false, error: "invalid capture status update" }, { status: 400 });
  }

  const note = await updateCaptureStatus(path, status);
  return NextResponse.json({ ok: true, note });
}
