import { NextResponse } from "next/server";
import { withCors } from "@/lib/cors";

export function asMetadata() {
  const base = process.env.NEXT_PUBLIC_MCP_BASE_URL ?? "";
  return withCors(NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/api/mcp/token`,
    registration_endpoint: `${base}/api/mcp/register`,
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    response_types_supported: ["code"],
    scopes_supported: ["read", "write"],
  }), undefined, true);
}

export function resourceMetadata() {
  const base = process.env.NEXT_PUBLIC_MCP_BASE_URL ?? "";
  return withCors(NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "write"],
  }), undefined, true);
}
