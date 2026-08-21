import { NextRequest, NextResponse } from "next/server";
import { createTask, updateNote } from "@/lib/vault";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true, allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 512 * 1024); } catch (error) { return bodyErrorResponse(error); }

  if (body.action === "create") {
    const note = await createTask({
      title: typeof body.title === "string" && body.title.trim() ? body.title : "Untitled task",
      area: typeof body.area === "string" ? body.area : "Projects",
      priority: typeof body.priority === "string" ? body.priority : "medium",
      why: typeof body.content === "string" ? body.content : "",
    });
    return NextResponse.json({ ok: true, note });
  }

  if (body.action === "update") {
    if (typeof body.path !== "string") {
      return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
    }

    const note = await updateNote({
      relativePath: body.path,
      title: typeof body.title === "string" && body.title.trim() ? body.title : "Untitled task",
      status: typeof body.status === "string" ? body.status : "todo",
      area: typeof body.area === "string" ? body.area : "",
      priority: typeof body.priority === "string" ? body.priority : "medium",
      horizon: typeof body.horizon === "string" ? body.horizon : "",
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      content: typeof body.content === "string" ? body.content : "",
    });
    return NextResponse.json({ ok: true, note });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
