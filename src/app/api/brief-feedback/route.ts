import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import {
  saveBriefFeedback,
  type BriefFeedbackVerdict,
} from "@/lib/vault";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true })) {
    return unauthorizedResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 4 * 1024);
  } catch (error) {
    return bodyErrorResponse(error);
  }

  try {
    const verdict = String(body.verdict || "") as BriefFeedbackVerdict;
    const feedback = await saveBriefFeedback(
      String(body.path || ""),
      verdict,
      String(body.reason || ""),
    );
    return NextResponse.json({ ok: true, feedback });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Retour impossible" },
      { status: 400 },
    );
  }
}
