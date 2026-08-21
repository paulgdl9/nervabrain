import { NextRequest, NextResponse } from "next/server";
import { updateTaskStatus } from "@/lib/vault";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true, allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 16 * 1024); } catch (error) { return bodyErrorResponse(error); }
  if (!body || typeof body.path !== "string" || typeof body.status !== "string") {
    return NextResponse.json({ ok: false, error: "path and status are required" }, { status: 400 });
  }

  if (!["todo", "doing", "done", "abandoned"].includes(body.status)) {
    return NextResponse.json({ ok: false, error: "invalid status" }, { status: 400 });
  }

  const note = await updateTaskStatus(body.path, body.status);
  return NextResponse.json({ ok: true, note });
}
