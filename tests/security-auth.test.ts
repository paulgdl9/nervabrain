import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  authenticateRequest,
  resetCloudflareAccessCacheForTests,
  seedCloudflareAccessJwksForTests,
} from "../src/lib/auth";
import { rateLimit, clientIp, resetRateLimitForTests } from "../src/lib/rate-limit";

// --- Test helpers -----------------------------------------------------------

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

/** Mints an RS256 JWT and returns it alongside its public JWK (with a kid). */
function makeAccessJwt(claims: Record<string, unknown>) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  const header = base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return { token: `${header}.${payload}.${signature}`, jwk };
}

function sameOriginRequest(cfHeader?: string) {
  const headers: Record<string, string> = {
    host: "brain.example",
    origin: "https://brain.example",
    "sec-fetch-site": "same-origin",
  };
  if (cfHeader !== undefined) headers["cf-access-jwt-assertion"] = cfHeader;
  return new NextRequest("https://brain.example/api/notes", { method: "POST", headers });
}

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// --- S2: Cloudflare Access JWT ----------------------------------------------

test("a forged cf-access-jwt-assertion is rejected when CF_ACCESS_* is unconfigured", () => {
  resetCloudflareAccessCacheForTests();
  withEnv(
    {
      CAPTURE_TOKEN: "a".repeat(64),
      ALLOW_SAME_ORIGIN_WRITES: "false",
      CF_ACCESS_TEAM_DOMAIN: undefined,
      CF_ACCESS_AUD: undefined,
    },
    () => {
      // Presence of any header value must not grant trust: same-origin writes
      // are off and there is no CF verification configured.
      const req = sameOriginRequest("obviously-forged-header-value");
      assert.equal(authenticateRequest(req, { scope: "write", allowSameOrigin: true }), null);
    },
  );
});

test("a syntactically-valid but unverifiable cf assertion is rejected when configured", () => {
  resetCloudflareAccessCacheForTests();
  const audTag = "aud-tag-123";
  // A JWT signed by an unrelated key; its kid is never seeded into the cache.
  const { token } = makeAccessJwt({
    aud: audTag,
    iss: "https://acme.cloudflareaccess.com",
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  withEnv(
    {
      CAPTURE_TOKEN: "a".repeat(64),
      ALLOW_SAME_ORIGIN_WRITES: "false",
      CF_ACCESS_TEAM_DOMAIN: "acme",
      CF_ACCESS_AUD: audTag,
    },
    () => {
      const req = sameOriginRequest(token);
      // No matching key in cache -> not trusted (fail-safe on cold cache).
      assert.equal(authenticateRequest(req, { scope: "write", allowSameOrigin: true }), null);
    },
  );
});

test("a valid, audience-matching cf assertion grants same-origin write trust", () => {
  resetCloudflareAccessCacheForTests();
  const audTag = "aud-tag-abc";
  const { token, jwk } = makeAccessJwt({
    aud: audTag,
    iss: "https://acme.cloudflareaccess.com",
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  seedCloudflareAccessJwksForTests([jwk as never]);
  withEnv(
    {
      CAPTURE_TOKEN: "a".repeat(64),
      // Leave ALLOW_SAME_ORIGIN_WRITES unset: this is the real production shape
      // (Cloudflare tunnel + Access, flag not set). A cryptographically verified
      // CF assertion is what grants trust here. ALLOW_SAME_ORIGIN_WRITES="false"
      // remains a hard kill-switch that would override even a valid assertion,
      // per .env.example ("disable dashboard writes entirely").
      ALLOW_SAME_ORIGIN_WRITES: undefined,
      CF_ACCESS_TEAM_DOMAIN: "acme",
      CF_ACCESS_AUD: audTag,
    },
    () => {
      const req = sameOriginRequest(token);
      assert.equal(
        authenticateRequest(req, { scope: "write", allowSameOrigin: true })?.kind,
        "same-origin",
      );
    },
  );
});

test("a cf assertion with the wrong audience is rejected even when signed by a cached key", () => {
  resetCloudflareAccessCacheForTests();
  const { token, jwk } = makeAccessJwt({
    aud: "someone-elses-app",
    iss: "https://acme.cloudflareaccess.com",
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  seedCloudflareAccessJwksForTests([jwk as never]);
  withEnv(
    {
      CAPTURE_TOKEN: "a".repeat(64),
      ALLOW_SAME_ORIGIN_WRITES: "false",
      CF_ACCESS_TEAM_DOMAIN: "acme",
      CF_ACCESS_AUD: "my-app",
    },
    () => {
      const req = sameOriginRequest(token);
      assert.equal(authenticateRequest(req, { scope: "write", allowSameOrigin: true }), null);
    },
  );
});

test("an expired cf assertion is rejected even when signed by a cached key", () => {
  resetCloudflareAccessCacheForTests();
  const audTag = "aud-exp";
  const { token, jwk } = makeAccessJwt({
    aud: audTag,
    iss: "https://acme.cloudflareaccess.com",
    exp: Math.floor(Date.now() / 1000) - 10,
  });
  seedCloudflareAccessJwksForTests([jwk as never]);
  withEnv(
    {
      CAPTURE_TOKEN: "a".repeat(64),
      ALLOW_SAME_ORIGIN_WRITES: "false",
      CF_ACCESS_TEAM_DOMAIN: "acme",
      CF_ACCESS_AUD: audTag,
    },
    () => {
      const req = sameOriginRequest(token);
      assert.equal(authenticateRequest(req, { scope: "write", allowSameOrigin: true }), null);
    },
  );
});

// --- S3: rate limiting ------------------------------------------------------

test("rate limiter allows up to the limit then returns 429-style refusals", () => {
  resetRateLimitForTests();
  const key = "login:1.2.3.4";
  const opts = { limit: 5, windowMs: 60_000 };
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit(key, opts).ok, true, `attempt ${i + 1} should pass`);
  }
  const blocked = rateLimit(key, opts);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
});

test("rate limiter buckets are per-key (per-IP), not global", () => {
  resetRateLimitForTests();
  const opts = { limit: 2, windowMs: 60_000 };
  assert.equal(rateLimit("login:10.0.0.1", opts).ok, true);
  assert.equal(rateLimit("login:10.0.0.1", opts).ok, true);
  assert.equal(rateLimit("login:10.0.0.1", opts).ok, false);
  // A different IP is unaffected.
  assert.equal(rateLimit("login:10.0.0.2", opts).ok, true);
});

test("clientIp prefers cf-connecting-ip, then x-forwarded-for, then fallback", () => {
  const cf = new NextRequest("https://brain.example/authorize", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
  });
  assert.equal(clientIp(cf), "203.0.113.7");

  const xff = new NextRequest("https://brain.example/authorize", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.2" },
  });
  assert.equal(clientIp(xff), "198.51.100.9");

  const none = new NextRequest("https://brain.example/authorize", { method: "POST" });
  assert.equal(clientIp(none), "unknown");
});
