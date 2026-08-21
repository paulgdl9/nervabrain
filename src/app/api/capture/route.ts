import { NextRequest, NextResponse } from "next/server";
import { createCapture, processInbox } from "@/lib/vault";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, limitedString, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!authenticateRequest(request, { scope: "write", allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 256 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const text = limitedString(body.text, 200_000);
  if (!text?.trim()) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });

  const note = await createCapture({
    title: limitedString(body.title, 300),
    source: limitedString(body.source, 80) ?? "api",
    url: limitedString(body.url, 2_048),
    text,
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 50).map((tag) => String(tag).slice(0, 80)) : [],
  });
  const derived = await processInbox(1, [note.relativePath]);
  const routed = derived[0]?.relativePath || note.relativePath;

  return NextResponse.json({ ok: true, note, routed, processing: "complete" });
}
