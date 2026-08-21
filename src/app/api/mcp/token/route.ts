import { NextRequest, NextResponse } from "next/server";
import { verifyCaptureToken } from "@/lib/auth";
import { preflight, withCors } from "@/lib/cors";
import { readRequestText, RequestBodyError } from "@/lib/http-security";
import {
  consumeCode,
  issueAccessToken,
  issueRefreshToken,
  normalizeScopes,
  rotateRefreshToken,
} from "@/lib/oauth-codes";

export const runtime = "nodejs";

export async function OPTIONS(request: NextRequest) {
  return preflight(request);
}

function oauthError(request: NextRequest, error: string, description: string, status = 400) {
  return withCors(NextResponse.json({ error, error_description: description }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  }), request);
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    const text = await readRequestText(request, 16 * 1024);
    let body: Record<string, string>;
    if (contentType === "application/x-www-form-urlencoded") {
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (contentType === "application/json") {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestBodyError("invalid body");
      body = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    } else {
      throw new RequestBodyError("unsupported content-type", 415);
    }

    if (body.grant_type === "authorization_code") {
      const result = consumeCode({
        code: body.code ?? "",
        verifier: body.code_verifier ?? "",
        clientId: body.client_id ?? "",
        redirectUri: body.redirect_uri ?? "",
      });
      if (!result.ok) return oauthError(request, "invalid_grant", result.reason);
      const access = issueAccessToken(body.client_id, result.scopes);
      return withCors(NextResponse.json({
        access_token: access.token,
        token_type: "Bearer",
        expires_in: access.expiresIn,
        refresh_token: issueRefreshToken(body.client_id, result.scopes),
        scope: result.scopes.join(" "),
      }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }), request);
    }

    if (body.grant_type === "refresh_token") {
      const result = rotateRefreshToken({
        token: body.refresh_token ?? "",
        clientId: body.client_id ?? "",
      });
      if (!result.ok) return oauthError(request, "invalid_grant", result.reason);
      return withCors(NextResponse.json({
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
        scope: result.scopes.join(" "),
      }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }), request);
    }

    if (body.grant_type === "client_credentials") {
      if (body.client_id !== "second-brain-automation" || !verifyCaptureToken(body.client_secret ?? "")) {
        return oauthError(request, "invalid_client", "invalid client credentials", 401);
      }
      const scopes = normalizeScopes(body.scope);
      if (!scopes) return oauthError(request, "invalid_scope", "supported scopes are read and write");
      const access = issueAccessToken(body.client_id, scopes);
      return withCors(NextResponse.json({
        access_token: access.token,
        token_type: "Bearer",
        expires_in: access.expiresIn,
        scope: scopes.join(" "),
      }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }), request);
    }

    return oauthError(request, "unsupported_grant_type", "grant_type is required");
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return oauthError(request, "invalid_request", "invalid request body", status);
  }
}
