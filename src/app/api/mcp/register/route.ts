import { NextRequest, NextResponse } from "next/server";
import { preflight, withCors } from "@/lib/cors";
import { bodyErrorResponse, limitedString, readJsonObject } from "@/lib/http-security";
import { isValidRedirectUri, registerClient } from "@/lib/oauth-codes";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request, 16 * 1024);
    const rawRedirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((value): value is string => typeof value === "string")
      : [];
    if (!redirectUris.length || rawRedirectUris.length !== redirectUris.length || redirectUris.length > 10 || !redirectUris.every(isValidRedirectUri)) {
      return withCors(NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 }), request);
    }
    const client = registerClient(redirectUris, limitedString(body.client_name, 120) ?? "MCP Client");
    return withCors(NextResponse.json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1_000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: client.clientName,
    }, { status: 201 }), request);
  } catch (error) {
    return withCors(bodyErrorResponse(error), request);
  }
}
