import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import { decideBriefSuggestion } from "@/lib/vault";

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

  const decision = String(body.decision || "");
  if (decision !== "accepted" && decision !== "rejected") {
    return NextResponse.json({ ok: false, error: "Décision invalide" }, { status: 400 });
  }

  try {
    const suggestions = await decideBriefSuggestion(
      String(body.path || ""),
      String(body.id || ""),
      decision,
    );
    const decided = suggestions.find((entry) => entry.id === String(body.id || ""));
    // An apply that failed leaves the proposal pending; report it as an error so
    // the UI does not show a green check over a change that never happened.
    if (decision === "accepted" && decided?.state !== "accepted") {
      return NextResponse.json(
        { ok: false, error: decided?.error || "Application impossible" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Décision impossible" },
      { status: 400 },
    );
  }
}
