import { NextRequest, NextResponse } from "next/server";
import { generateDailyBrief } from "@/lib/vault";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!authenticateRequest(request, { scope: "write", allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 8 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const force = body?.force !== false;
  try {
    const note = await generateDailyBrief({ force, requireAi: body?.requireAi === true });
    return NextResponse.json({ ok: true, note, generatedBy: note.data.generated_by || "unknown" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
