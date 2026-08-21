import { NextRequest, NextResponse } from "next/server";
import { createWorkoutFit, createWorkoutGarminJson, findPlannedSession, validateWorkoutFit } from "@/lib/fit-workout";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session") || "";
  const format = request.nextUrl.searchParams.get("format") || "fit";
  const session = await findPlannedSession(sessionId);
  if (!session) return NextResponse.json({ ok: false, error: "Séance introuvable" }, { status: 404 });

  try {
    if (format === "json") {
      const workout = createWorkoutGarminJson(session);
      return new NextResponse(JSON.stringify(workout.data, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${workout.fileName}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (format !== "fit") throw new Error("Format d'export inconnu");

    const workout = createWorkoutFit(session);
    if (!validateWorkoutFit(workout.bytes).valid) throw new Error("Le fichier FIT généré est invalide");
    return new NextResponse(Buffer.from(workout.bytes), {
      headers: {
        "content-type": "application/vnd.ant.fit",
        "content-disposition": `attachment; filename="${workout.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Export FIT impossible" },
      { status: 400 },
    );
  }
}
