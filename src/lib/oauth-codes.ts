import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "@/lib/atomic-write";

export type OAuthScope = "read" | "write";

export type OAuthClient = {
  clientId: string;
  redirectUris: string[];
  clientName: string;
  createdAt: number;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scopes: OAuthScope[];
  expiresAt: number;
};

export type AccessTokenClaims = {
  clientId: string;
  scopes: OAuthScope[];
  expiresAt: number;
};

type RefreshTokenClaims = {
  clientId: string;
  scopes: OAuthScope[];
  expiresAt: number;
};

type OAuthState = {
  clients: Map<string, OAuthClient>;
  codes: Map<string, AuthorizationCode>;
  accessTokens: Map<string, AccessTokenClaims>;
  refreshTokens: Map<string, RefreshTokenClaims>;
};

const globalState = globalThis as typeof globalThis & { __secondBrainOAuthState?: OAuthState };
const state = globalState.__secondBrainOAuthState ??= {
  clients: new Map(),
  codes: new Map(),
  accessTokens: new Map(),
  refreshTokens: new Map(),
};
// Dev HMR may have cached the pre-refresh-token shape of the state object.
state.refreshTokens ??= new Map();
const { clients, codes, accessTokens, refreshTokens } = state;
const MAX_CLIENTS = 1_000;
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

// --- Persistence -------------------------------------------------------------
//
// Clients and tokens survive process restarts so an MCP connector (e.g. the
// Claude app) does not lose its registration on every deploy. Authorization
// codes stay memory-only: they live five minutes and are useless across a
// restart anyway. The file stores token *hashes*, never raw tokens, and is
// created with mode 600 by atomicWriteFile.

const STATE_VERSION = 1;

function stateFilePath() {
  const configured = process.env.OAUTH_STATE_FILE?.trim();
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured || "data/oauth-state.json");
}

let loaded = false;
let pendingPersist: Promise<void> = Promise.resolve();

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  let raw: string;
  try {
    raw = fs.readFileSync(stateFilePath(), "utf8");
  } catch {
    return; // First run or no persisted state: start empty.
  }
  try {
    const parsed = JSON.parse(raw) as {
      v?: number;
      clients?: [string, OAuthClient][];
      accessTokens?: [string, AccessTokenClaims][];
      refreshTokens?: [string, RefreshTokenClaims][];
    };
    if (parsed.v !== STATE_VERSION) return;
    for (const [id, client] of parsed.clients ?? []) clients.set(id, client);
    for (const [hash, claims] of parsed.accessTokens ?? []) accessTokens.set(hash, claims);
    for (const [hash, claims] of parsed.refreshTokens ?? []) refreshTokens.set(hash, claims);
    cleanup();
  } catch (error) {
    // A corrupt state file must not take OAuth down; clients just re-register.
    console.error("[oauth] failed to load persisted state, starting empty:", error);
  }
}

function persist() {
  const snapshot = JSON.stringify({
    v: STATE_VERSION,
    clients: [...clients],
    accessTokens: [...accessTokens],
    refreshTokens: [...refreshTokens],
  });
  const target = stateFilePath();
  pendingPersist = pendingPersist
    .catch(() => undefined)
    .then(() => atomicWriteFile(target, snapshot))
    .catch((error) => {
      console.error(`[oauth] failed to persist state to ${target}:`, error);
    });
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function cleanup(now = Date.now()) {
  for (const [code, value] of codes) if (value.expiresAt <= now) codes.delete(code);
  for (const [tokenHash, value] of accessTokens) if (value.expiresAt <= now) accessTokens.delete(tokenHash);
  for (const [tokenHash, value] of refreshTokens) if (value.expiresAt <= now) refreshTokens.delete(tokenHash);
  if (clients.size > MAX_CLIENTS) {
    const oldest = [...clients.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const client of oldest.slice(0, clients.size - MAX_CLIENTS)) clients.delete(client.clientId);
  }
}

export function normalizeScopes(input: string | null | undefined): OAuthScope[] | null {
  const values = (input || "read write").split(/\s+/).filter(Boolean);
  if (!values.length || values.some((scope) => scope !== "read" && scope !== "write")) return null;
  return [...new Set(values)] as OAuthScope[];
}

export function isValidRedirectUri(value: string) {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

export function registerClient(redirectUris: string[], clientName: string): OAuthClient {
  ensureLoaded();
  cleanup();
  const client: OAuthClient = {
    clientId: `mcp-${randomToken(24)}`,
    redirectUris: [...new Set(redirectUris)],
    clientName: clientName.slice(0, 120) || "MCP Client",
    createdAt: Date.now(),
  };
  clients.set(client.clientId, client);
  persist();
  return client;
}

export function getClient(clientId: string) {
  ensureLoaded();
  return clients.get(clientId) ?? null;
}

export function validateClientRedirect(clientId: string, redirectUri: string) {
  ensureLoaded();
  return clients.get(clientId)?.redirectUris.includes(redirectUri) === true;
}

export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return false;
  const actual = Buffer.from(hash(verifier));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function issueCode(input: Omit<AuthorizationCode, "expiresAt">): string {
  ensureLoaded();
  cleanup();
  const code = randomToken();
  codes.set(hash(code), { ...input, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export function consumeCode(input: {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}): { ok: true; scopes: OAuthScope[] } | { ok: false; reason: "expired" | "notfound" | "binding" | "pkce" } {
  ensureLoaded();
  cleanup();
  const key = hash(input.code);
  const stored = codes.get(key);
  if (!stored) return { ok: false, reason: "notfound" };
  if (stored.clientId !== input.clientId || stored.redirectUri !== input.redirectUri) {
    return { ok: false, reason: "binding" };
  }
  codes.delete(key);
  if (stored.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
  if (!verifyPkce(input.verifier, stored.challenge)) return { ok: false, reason: "pkce" };
  return { ok: true, scopes: stored.scopes };
}

export function issueAccessToken(clientId: string, scopes: OAuthScope[]) {
  ensureLoaded();
  cleanup();
  const token = `sb_${randomToken()}`;
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
  accessTokens.set(hash(token), { clientId, scopes: [...scopes], expiresAt });
  persist();
  return { token, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1_000) };
}

export function issueRefreshToken(clientId: string, scopes: OAuthScope[]) {
  ensureLoaded();
  cleanup();
  const token = `sbr_${randomToken()}`;
  const expiresAt = Date.now() + REFRESH_TOKEN_TTL_MS;
  refreshTokens.set(hash(token), { clientId, scopes: [...scopes], expiresAt });
  persist();
  return token;
}

/**
 * Redeems a refresh token: validates expiry and client binding, then rotates it
 * (the old token is invalidated and a new refresh + access pair is issued).
 */
export function rotateRefreshToken(input: { token: string; clientId: string }):
  | { ok: true; accessToken: string; expiresIn: number; refreshToken: string; scopes: OAuthScope[] }
  | { ok: false; reason: "notfound" | "expired" | "binding" } {
  ensureLoaded();
  cleanup();
  const key = hash(input.token);
  const stored = refreshTokens.get(key);
  if (!stored) return { ok: false, reason: "notfound" };
  if (stored.clientId !== input.clientId) return { ok: false, reason: "binding" };
  refreshTokens.delete(key);
  if (stored.expiresAt <= Date.now()) {
    persist();
    return { ok: false, reason: "expired" };
  }
  const access = issueAccessToken(stored.clientId, stored.scopes);
  const nextRefresh = issueRefreshToken(stored.clientId, stored.scopes);
  return {
    ok: true,
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken: nextRefresh,
    scopes: [...stored.scopes],
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  ensureLoaded();
  cleanup();
  const claims = accessTokens.get(hash(token));
  return claims && claims.expiresAt > Date.now() ? { ...claims, scopes: [...claims.scopes] } : null;
}

export function resetOAuthStateForTests(options: { reloadFromDisk?: boolean } = {}) {
  clients.clear();
  codes.clear();
  accessTokens.clear();
  refreshTokens.clear();
  // By default stay memory-only so unit tests never touch the filesystem.
  loaded = !options.reloadFromDisk;
}

/** Awaits any in-flight persistence write (test-only). */
export function flushOAuthStateForTests() {
  return pendingPersist;
}
