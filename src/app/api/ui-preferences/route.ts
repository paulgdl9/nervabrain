import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";
import {
  saveDashboardLayoutPreference,
  saveWorkspaceAppearancePreference,
} from "@/lib/ui-preferences";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 256 * 1024); } catch (error) { return bodyErrorResponse(error); }

  if (body.kind === "dashboard") {
    const preference = await saveDashboardLayoutPreference(body.value);
    return NextResponse.json({ ok: true, preference });
  }
  if (body.kind === "workspace-appearance") {
    const preference = await saveWorkspaceAppearancePreference(body.value);
    return NextResponse.json({ ok: true, preference });
  }
  return NextResponse.json({ ok: false, error: "unsupported preference kind" }, { status: 400 });
}
