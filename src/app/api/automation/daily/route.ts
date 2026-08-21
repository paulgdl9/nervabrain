import { NextRequest, NextResponse } from "next/server";
import {
  generateDailyBrief,
  generateWeeklyReview,
  ingestFeeds,
  processInbox,
} from "@/lib/vault";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import { generateTrailCoachDecision } from "@/lib/trail";

export const runtime = "nodejs";

function isMonday() {
  const timeZone = process.env.TIMEZONE || "UTC";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(new Date()) === "Mon";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  if (!authenticateRequest(request, { scope: "write", allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 16 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const requestedLimit = Number(body?.inboxLimit ?? 5);
  const inboxLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 0), 25)
    : 5;
  const errors: Record<string, string> = {};

  let feeds: Awaited<ReturnType<typeof ingestFeeds>> | null = null;
  if (body?.ingestFeeds !== false) {
    try {
      feeds = await ingestFeeds({ force: body?.forceFeeds === true });
    } catch (error) {
      errors.feeds = errorMessage(error);
    }
  }

  let processedInbox: Awaited<ReturnType<typeof processInbox>> = [];
  if (inboxLimit > 0) {
    try {
      processedInbox = await processInbox(inboxLimit);
    } catch (error) {
      errors.inbox = errorMessage(error);
    }
  }

  try {
    // Default is non-destructive: only overwrite an existing daily brief when the
    // caller explicitly opts in with forceBrief:true. The scheduled 07:00 run must
    // preserve manual edits to today's 06-Daily note (contract: retain useful content).
    const brief = await generateDailyBrief({ force: body?.forceBrief === true });
    const shouldGenerateWeekly = body?.generateWeekly === true
      || (body?.generateWeekly !== false && isMonday());
    const weekly = shouldGenerateWeekly
      ? await generateWeeklyReview({ force: body?.forceWeekly === true })
      : null;
    const coach = weekly ? await generateTrailCoachDecision().catch((error) => {
      errors.coach = errorMessage(error);
      return null;
    }) : null;

    const generatedBy = String(brief?.data.generated_by || "unknown");
    const fallbackCount = processedInbox.filter((note) =>
      note.data.ai_pending === true || note.data.generated_by === "local-fallback"
    ).length;
    const weeklyGeneratedBy = weekly ? String(weekly.data.generated_by || "unknown") : null;
    const degraded = Object.keys(errors).length > 0
      || fallbackCount > 0
      || !generatedBy.startsWith("ai:")
      || Boolean(weeklyGeneratedBy && !weeklyGeneratedBy.startsWith("ai:"));

    return NextResponse.json({
      ok: !degraded,
      status: degraded ? "degraded" : "healthy",
      degraded,
      feeds,
      processedInbox: processedInbox.map((note) => note.relativePath),
      fallbackCount,
      brief: brief?.relativePath || null,
      generatedBy,
      weekly: weekly?.relativePath || null,
      weeklyGeneratedBy,
      coachEngine: coach?.engine || null,
      errors,
    }, { status: degraded ? 503 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error), errors },
      { status: 500 },
    );
  }
}
