import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

// Point OAuth persistence at a scratch file so tests never touch ./data.
// stateFilePath() is resolved lazily on every load/persist, so assigning here
// (before any oauth-codes call) is sufficient despite import hoisting.
process.env.OAUTH_STATE_FILE = path.join(os.tmpdir(), `oauth-state-test-${process.pid}-${randomUUID()}.json`);

import { GET as authorizeGet } from "../src/app/authorize/route";
import { authenticateRequest } from "../src/lib/auth";
import {
  consumeCode,
  flushOAuthStateForTests,
  getClient,
  issueAccessToken,
  issueCode,
  issueRefreshToken,
  isValidRedirectUri,
  registerClient,
  resetOAuthStateForTests,
  rotateRefreshToken,
  verifyAccessToken,
} from "../src/lib/oauth-codes";

function challenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

test("consent page form-action allows the validated redirect origin, so the post-consent 302 is not CSP-blocked", async () => {
  resetOAuthStateForTests();
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const client = registerClient([redirectUri], "Claude");
  const url = new URL("https://brain.example/authorize");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", "a".repeat(43));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", "read write");
  const response = await authorizeGet(new NextRequest(url));
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /form-action 'self' https:\/\/claude\.ai;/,
  );
});

test("authorization codes are PKCE-bound, client-bound, and one-shot", () => {
  resetOAuthStateForTests();
  const redirectUri = "https://client.example/callback";
  const client = registerClient([redirectUri], "Test client");
  const verifier = "a".repeat(64);
  const code = issueCode({ clientId: client.clientId, redirectUri, challenge: challenge(verifier), scopes: ["read"] });

  assert.deepEqual(consumeCode({ code, verifier, clientId: client.clientId, redirectUri }), { ok: true, scopes: ["read"] });
  assert.deepEqual(consumeCode({ code, verifier, clientId: client.clientId, redirectUri }), { ok: false, reason: "notfound" });
});

test("authorization code rejects a mismatched redirect without consuming the valid binding", () => {
  resetOAuthStateForTests();
  const redirectUri = "https://client.example/callback";
  const client = registerClient([redirectUri], "Test client");
  const verifier = "b".repeat(64);
  const code = issueCode({ clientId: client.clientId, redirectUri, challenge: challenge(verifier), scopes: ["write"] });

  assert.equal(consumeCode({ code, verifier, clientId: client.clientId, redirectUri: "https://evil.example/callback" }).ok, false);
  assert.equal(consumeCode({ code, verifier, clientId: client.clientId, redirectUri }).ok, true);
});

test("access tokens are opaque, expiring claims rather than CAPTURE_TOKEN", () => {
  resetOAuthStateForTests();
  const issued = issueAccessToken("client", ["read"]);
  assert.match(issued.token, /^sb_/);
  assert.deepEqual(verifyAccessToken(issued.token)?.scopes, ["read"]);
  assert.equal(verifyAccessToken("not-a-token"), null);
});

test("redirect URIs require HTTPS except exact loopback HTTP", () => {
  assert.equal(isValidRedirectUri("https://client.example/callback"), true);
  assert.equal(isValidRedirectUri("http://127.0.0.1:4321/callback"), true);
  assert.equal(isValidRedirectUri("http://client.example/callback"), false);
  assert.equal(isValidRedirectUri("https://user:pass@client.example/callback"), false);
  assert.equal(isValidRedirectUri("https://client.example/callback#fragment"), false);
});

test("API auth fails closed and scopes OAuth tokens", () => {
  resetOAuthStateForTests();
  const previous = process.env.CAPTURE_TOKEN;
  delete process.env.CAPTURE_TOKEN;
  const bare = new NextRequest("https://brain.example/api/notes", { method: "POST" });
  assert.equal(authenticateRequest(bare, { scope: "write", allowCaptureHeader: true }), null);

  const token = issueAccessToken("reader", ["read"]).token;
  const oauth = new NextRequest("https://brain.example/api/mcp", { headers: { authorization: `Bearer ${token}` } });
  assert.ok(authenticateRequest(oauth, { scope: "read" }));
  assert.equal(authenticateRequest(oauth, { scope: "write" }), null);
  if (previous === undefined) delete process.env.CAPTURE_TOKEN; else process.env.CAPTURE_TOKEN = previous;
});

test("same-origin dashboard writes require explicit opt-in, a configured secret, and browser provenance", () => {
  const previousToken = process.env.CAPTURE_TOKEN;
  const previousOptIn = process.env.ALLOW_SAME_ORIGIN_WRITES;
  process.env.CAPTURE_TOKEN = "a".repeat(64);
  process.env.ALLOW_SAME_ORIGIN_WRITES = "true";
  const trusted = new NextRequest("https://brain.example/api/notes", {
    method: "POST",
    headers: { host: "brain.example", origin: "https://brain.example", "sec-fetch-site": "same-origin" },
  });
  const crossSite = new NextRequest("https://brain.example/api/notes", {
    method: "POST",
    headers: { host: "brain.example", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(authenticateRequest(trusted, { scope: "write", allowSameOrigin: true })?.kind, "same-origin");
  assert.equal(authenticateRequest(crossSite, { scope: "write", allowSameOrigin: true }), null);
  if (previousToken === undefined) delete process.env.CAPTURE_TOKEN; else process.env.CAPTURE_TOKEN = previousToken;
  if (previousOptIn === undefined) delete process.env.ALLOW_SAME_ORIGIN_WRITES; else process.env.ALLOW_SAME_ORIGIN_WRITES = previousOptIn;
});

test("refresh tokens rotate: old token dies, new pair works, client binding enforced", () => {
  resetOAuthStateForTests();
  const refresh = issueRefreshToken("client-a", ["read", "write"]);
  assert.match(refresh, /^sbr_/);

  // Wrong client cannot redeem someone else's refresh token.
  assert.equal(rotateRefreshToken({ token: refresh, clientId: "client-b" }).ok, false);

  const rotated = rotateRefreshToken({ token: refresh, clientId: "client-a" });
  assert.ok(rotated.ok);
  if (rotated.ok) {
    assert.deepEqual(verifyAccessToken(rotated.accessToken)?.scopes, ["read", "write"]);
    // The redeemed token is single-use.
    assert.equal(rotateRefreshToken({ token: refresh, clientId: "client-a" }).ok, false);
    // The replacement token works.
    assert.ok(rotateRefreshToken({ token: rotated.refreshToken, clientId: "client-a" }).ok);
  }
});

test("clients and tokens survive a restart via the persisted state file", async () => {
  resetOAuthStateForTests();
  const client = registerClient(["https://client.example/callback"], "Persistent client");
  const access = issueAccessToken(client.clientId, ["read"]);
  const refresh = issueRefreshToken(client.clientId, ["read"]);
  await flushOAuthStateForTests();

  // Simulate a process restart: wipe memory, then lazy-reload from disk.
  resetOAuthStateForTests({ reloadFromDisk: true });
  assert.equal(getClient(client.clientId)?.clientName, "Persistent client");
  assert.deepEqual(verifyAccessToken(access.token)?.scopes, ["read"]);
  assert.ok(rotateRefreshToken({ token: refresh, clientId: client.clientId }).ok);
});

test("authorization page escapes dynamic client names and sends restrictive headers", async () => {
  resetOAuthStateForTests();
  const redirectUri = "https://client.example/callback";
  const client = registerClient([redirectUri], '<img src=x onerror="alert(1)">');
  const verifier = "c".repeat(64);
  const url = new URL("https://brain.example/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
    scope: "read",
  }).toString();
  const response = await authorizeGet(new NextRequest(url));
  const html = await response.text();
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

test("authorization page follows the selected English locale", async () => {
  resetOAuthStateForTests();
  const redirectUri = "https://client.example/callback";
  const client = registerClient([redirectUri], "Test client");
  const url = new URL("https://brain.example/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    scope: "read",
  }).toString();
  const response = await authorizeGet(new NextRequest(url, {
    headers: { cookie: "second-brain:locale=en" },
  }));
  const html = await response.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Authorize access/);
  assert.doesNotMatch(html, /Autoriser l’accès/);
});
