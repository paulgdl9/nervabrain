import { NextRequest, NextResponse } from "next/server";
import { ingestFeeds } from "@/lib/vault";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!authenticateRequest(request, { scope: "write", allowCaptureHeader: true })) return unauthorizedResponse();
  const result = await ingestFeeds({ force: true });
  return NextResponse.json({ ok: true, ...result });
}
