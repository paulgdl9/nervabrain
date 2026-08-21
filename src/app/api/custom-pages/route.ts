import { NextRequest, NextResponse } from "next/server";
import { createCustomPage, listCustomPages } from "@/lib/vault";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

// Lets the client-side nav (AppNav) learn about custom pages created at
// runtime, since vault reads only happen server-side.
export async function GET(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "read", allowSameOrigin: true, allowCaptureHeader: true })) {
    return unauthorizedResponse("read");
  }
  const pages = await listCustomPages();
  return NextResponse.json({
    ok: true,
    pages: pages.map((page) => ({ slug: page.slug, title: page.title, icon: page.icon })),
  });
}

// Creates a page straight from the sidebar ("+ New page"), Notion-style, so
// the user never has to detour through settings to start a fresh document.
export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true, allowCaptureHeader: true })) {
    return unauthorizedResponse();
  }
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 64 * 1024); } catch (error) { return bodyErrorResponse(error); }
  const title = typeof body.title === "string" && body.title.trim() ? body.title : "Untitled";
  const icon = typeof body.icon === "string" ? body.icon : "";
  try {
    const page = await createCustomPage(title, icon);
    return NextResponse.json({ ok: true, slug: page.slug, title: page.title, icon: page.icon });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not create page" },
      { status: 400 },
    );
  }
}
