import { createHmac, timingSafeEqual } from "node:crypto";

// Gates the dashboard *pages* (not /api, which has its own token/OAuth auth
// in src/lib/auth.ts). A single shared password, sessioned via a signed
// httpOnly cookie. See middleware.ts and src/app/login/.

export const SESSION_COOKIE = "sb_dashboard_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns the configured dashboard password, or null if auth is disabled. */
export function configuredDashboardPassword(): string | null {
  const password = process.env.DASHBOARD_PASSWORD?.trim() ?? "";
  return password.length > 0 ? password : null;
}

export function verifyDashboardPassword(candidate: string) {
  const expected = configuredDashboardPassword();
  return Boolean(expected && candidate && safeEqual(candidate, expected));
}

/**
 * Secret used to sign the session cookie. Prefers a dedicated SESSION_SECRET,
 * falls back to CAPTURE_TOKEN (already a private, high-entropy secret in this
 * deployment), and finally to the dashboard password itself so auth still
 * works (forgery still requires knowing the password) if neither is set.
 */
function sessionSecret(): string | null {
  const dedicated = process.env.SESSION_SECRET?.trim();
  if (dedicated) return dedicated;
  const captureToken = process.env.CAPTURE_TOKEN?.trim();
  if (captureToken && captureToken !== "replace-with-random-token") return captureToken;
  return configuredDashboardPassword();
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Creates a signed, expiring session token to store in the cookie. */
export function createSessionToken(): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload, secret)}`;
}

/** Verifies a session token from the cookie. Returns true if valid and unexpired. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const secret = sessionSecret();
  if (!secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload, secret);
  if (!safeEqual(signature, expected)) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  return Math.floor(Date.now() / 1000) < expiresAt;
}

export const SESSION_COOKIE_MAX_AGE = SESSION_MAX_AGE_SECONDS;
