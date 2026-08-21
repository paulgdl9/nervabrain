import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import { saveTrailFeedback, type TrailFeedback } from "@/lib/trail";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true })) return unauthorizedResponse();

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 16 * 1024);
  } catch (error) {
    return bodyErrorResponse(error);
  }

  try {
    const feedback = await saveTrailFeedback({
      activityId: String(body.activityId || ""),
      rpe: Number(body.rpe),
      pain: Number(body.pain),
      feeling: String(body.feeling || "neutral") as TrailFeedback["feeling"],
      note: String(body.note || "").trim(),
    });
    return NextResponse.json({ ok: true, feedback });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Feedback impossible" },
      { status: 400 },
    );
  }
}
