import { createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, type OAuthScope } from "@/lib/oauth-codes";

export type AuthContext = {
  kind: "capture-token" | "oauth" | "same-origin";
  scopes: ReadonlySet<OAuthScope>;
};

const ALL_SCOPES = new Set<OAuthScope>(["read", "write"]);

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Cloudflare Access JWT verification (S2) --------------------------------
//
// Cloudflare Access injects a signed `cf-access-jwt-assertion` header on every
// request it forwards. Its mere *presence* proves nothing: any client that
// reaches the origin directly (bypassing the tunnel) can forge the header.
// We therefore verify the RS256 signature against the team's public JWKS and
// check the audience (AUD tag of this application).
//
// Default-safe: if CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are not configured,
// the header is never trusted and callers fall back to loopback/same-origin.
//
// The JWKS is cached in-process with a TTL and refreshed lazily in the
// background. On a cold cache we simply do not trust the header yet (fail
// safe) rather than blocking the request on a network fetch — this keeps
// authenticateRequest synchronous for its many call sites.

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string };

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
const JWKS_TIMEOUT_MS = 5_000;

let jwksCache: { keys: Map<string, Jwk>; fetchedAt: number } | null = null;
let jwksInflight: Promise<void> | null = null;

function cfAccessConfig(): { teamDomain: string; aud: string } | null {
  const rawDomain = process.env.CF_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const aud = process.env.CF_ACCESS_AUD?.trim() ?? "";
  if (!rawDomain || !aud) return null;
  // Accept either "team" or "team.cloudflareaccess.com" or a full URL.
  let host = rawDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host.includes(".")) host = `${host}.cloudflareaccess.com`;
  return { teamDomain: host, aud };
}

function certsUrl(teamDomain: string): string {
  return `https://${teamDomain}/cdn-cgi/access/certs`;
}

function refreshJwks(teamDomain: string): Promise<void> {
  if (jwksInflight) return jwksInflight;
  jwksInflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS);
      let payload: { keys?: Jwk[] };
      try {
        const response = await fetch(certsUrl(teamDomain), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        payload = (await response.json()) as { keys?: Jwk[] };
      } finally {
        clearTimeout(timer);
      }
      const keys = new Map<string, Jwk>();
      for (const key of payload.keys ?? []) {
        if (key.kid && key.kty === "RSA" && key.n && key.e) keys.set(key.kid, key);
      }
      if (keys.size > 0) jwksCache = { keys, fetchedAt: Date.now() };
    } catch {
      // Network/parse failure: keep any existing cache, trust nothing new.
    } finally {
      jwksInflight = null;
    }
  })();
  return jwksInflight;
}

function jwkToPublicKey(jwk: Jwk) {
  return createPublicKey({ key: jwk as never, format: "jwk" });
}

function decodeSegment(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

/**
 * Verifies a Cloudflare Access RS256 assertion against the cached JWKS and the
 * configured audience. Returns true only for a valid, unexpired token whose
 * signing key is already cached. Triggers a background JWKS refresh when the
 * cache is missing/stale so subsequent requests can succeed.
 */
function verifyCloudflareAccessJwt(token: string): boolean {
  const config = cfAccessConfig();
  if (!config || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: string; kid?: string };
  let claims: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string };
  try {
    header = JSON.parse(decodeSegment(headerPart).toString("utf8"));
    claims = JSON.parse(decodeSegment(payloadPart).toString("utf8"));
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || !header.kid) return false;

  const stale = !jwksCache || Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS;
  const key = jwksCache?.keys.get(header.kid);
  if (stale || !key) {
    // Refresh in the background; do not trust the header on a cold/stale cache.
    void refreshJwks(config.teamDomain);
    if (!key) return false;
  }

  // Signature check over the signing input.
  let verified = false;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`);
    verifier.end();
    verified = verifier.verify(jwkToPublicKey(key), decodeSegment(signaturePart));
  } catch {
    return false;
  }
  if (!verified) return false;

  // Audience must include the configured AUD tag.
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(config.aud) : aud === config.aud;
  if (!audOk) return false;

  // Issuer must be the team domain (defensive; CF sets this).
  if (claims.iss && claims.iss !== `https://${config.teamDomain}`) return false;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && now >= claims.exp) return false;
  if (typeof claims.nbf === "number" && now < claims.nbf - 60) return false;

  return true;
}

/** Test-only hook to reset the in-memory JWKS cache between cases. */
export function resetCloudflareAccessCacheForTests() {
  jwksCache = null;
  jwksInflight = null;
}

/** Test-only hook to seed the JWKS cache with a known key. */
export function seedCloudflareAccessJwksForTests(keys: Jwk[]) {
  const map = new Map<string, Jwk>();
  for (const key of keys) if (key.kid) map.set(key.kid, key);
  jwksCache = { keys: map, fetchedAt: Date.now() };
}

function configuredCaptureToken(): string | null {
  const token = process.env.CAPTURE_TOKEN?.trim() ?? "";
  if (token.length < 32 || token === "replace-with-random-token") return null;
  return token;
}

export function verifyCaptureToken(candidate: string) {
  const expected = configuredCaptureToken();
  return Boolean(expected && candidate && safeEqual(candidate, expected));
}

function requestOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0].trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return null;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "") || "http";
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function trustedSameOriginRequest(request: NextRequest) {
  if (!configuredCaptureToken()) return false;
  const origin = request.headers.get("origin");
  const expected = requestOrigin(request);
  const hostname = expected ? new URL(expected).hostname : "";
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  // A Cloudflare Access assertion is only a proof of trust when it is
  // *cryptographically verified* (signature + audience) against the team JWKS.
  // Presence alone is forgeable, so an unverified header counts for nothing —
  // and if CF_ACCESS_* is unconfigured, verification always fails (default-safe).
  const hasCloudflareAccess = verifyCloudflareAccessJwt(
    request.headers.get("cf-access-jwt-assertion") ?? "",
  );
  if (process.env.ALLOW_SAME_ORIGIN_WRITES !== "true" && !isLoopback && !hasCloudflareAccess) return false;
  return Boolean(
    origin
      && expected
      && origin === expected
      && request.headers.get("sec-fetch-site") === "same-origin",
  );
}

export function authenticateRequest(
  request: NextRequest,
  options: { scope: OAuthScope; allowSameOrigin?: boolean; allowCaptureHeader?: boolean },
): AuthContext | null {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (verifyCaptureToken(bearer)) {
    return { kind: "capture-token", scopes: ALL_SCOPES };
  }
  if (options.allowCaptureHeader && verifyCaptureToken(request.headers.get("x-capture-token") ?? "")) {
    return { kind: "capture-token", scopes: ALL_SCOPES };
  }

  const claims = bearer ? verifyAccessToken(bearer) : null;
  if (claims?.scopes.includes(options.scope)) {
    return { kind: "oauth", scopes: new Set(claims.scopes) };
  }

  if (options.allowSameOrigin && trustedSameOriginRequest(request)) {
    return { kind: "same-origin", scopes: ALL_SCOPES };
  }
  return null;
}

/**
 * Dashboard requests arriving through Cloudflare Access may be the first
 * request handled by a fresh process. In that case the synchronous fast path
 * starts the JWKS refresh but cannot validate the assertion yet. Browser-facing
 * routes use this helper so the first write waits for the signing keys instead
 * of spuriously returning 401 and losing the user's edit.
 */
export async function authenticateRequestAsync(
  request: NextRequest,
  options: { scope: OAuthScope; allowSameOrigin?: boolean; allowCaptureHeader?: boolean },
): Promise<AuthContext | null> {
  const immediate = authenticateRequest(request, options);
  if (immediate || !options.allowSameOrigin) return immediate;

  const assertion = request.headers.get("cf-access-jwt-assertion") ?? "";
  const config = cfAccessConfig();
  if (!assertion || !config) return null;

  await refreshJwks(config.teamDomain);
  return authenticateRequest(request, options);
}

export function unauthorizedResponse(scope: OAuthScope = "write") {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer realm="second-brain", scope="${scope}"`,
      },
    },
  );
}
