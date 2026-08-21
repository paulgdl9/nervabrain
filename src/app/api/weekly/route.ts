import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyReview } from "@/lib/vault";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import { generateTrailCoachDecision } from "@/lib/trail";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!authenticateRequest(request, { scope: "write", allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 8 * 1024); } catch (error) { return bodyErrorResponse(error); }
  try {
    const note = await generateWeeklyReview({ force: body?.force === true, requireAi: body?.requireAi === true });
    let coachError = "";
    const coach = await generateTrailCoachDecision().catch((error) => {
      coachError = error instanceof Error ? error.message : String(error);
      return null;
    });
    return NextResponse.json({
      ok: true,
      note,
      generatedBy: note.data.generated_by || "unknown",
      coachEngine: coach?.engine || null,
      coachError: coachError || null,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
