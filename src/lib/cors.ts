import { NextRequest, NextResponse } from "next/server";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version";

function configuredOrigins() {
  const values = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const base = process.env.NEXT_PUBLIC_MCP_BASE_URL;
  if (base) {
    try {
      values.push(new URL(base).origin);
    } catch {
      // Invalid deployment configuration must not broaden CORS.
    }
  }
  return new Set(values);
}

function corsHeaders(request?: NextRequest, publicMetadata = false): Record<string, string> {
  if (publicMetadata) {
    return { "Access-Control-Allow-Origin": "*", Vary: "Origin" };
  }
  const origin = request?.headers.get("origin") ?? "";
  if (!origin || !configuredOrigins().has(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function preflight(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  // Server-to-server MCP clients may probe OPTIONS without a browser Origin.
  // CORS restrictions only apply when an Origin is actually present.
  if (!origin) return new NextResponse(null, { status: 204, headers: { Vary: "Origin" } });
  if (!configuredOrigins().has(origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403, headers: { Vary: "Origin" } });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function withCors<T extends NextResponse>(response: T, request?: NextRequest, publicMetadata = false): T {
  Object.entries(corsHeaders(request, publicMetadata)).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
